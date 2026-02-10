import crypto from 'crypto';
import db from '@/lib/db';
import { authSessions, users } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { getChutesAuthSecret } from './secret';
import { sealString, unsealString } from './seal';
import {
  fetchChutesUserInfo,
  getChutesIdpClientCredentials,
  refreshChutesAccessToken,
  type ChutesIdpTokenResponse,
  type ChutesIdpUserInfo,
} from './chutesIdp';

export type AuthSession = {
  sessionId: string;
  user: {
    id: string;
    username: string | null;
  };
  accessToken: string;
  refreshToken: string | null;
  accessTokenExpiresAt: number | null;
  scope: string | null;
  tokenType: string | null;
};

const SESSION_LIFETIME_SECONDS = 30 * 24 * 60 * 60;

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

// Best-effort in-process mutex to prevent concurrent refresh_token rotations
// for the same session from causing spurious "invalid_grant" errors.
// This is safe even if we scale to multiple instances (it simply becomes a
// per-instance optimization; correctness still relies on DB state).
const refreshLocks: Map<string, Promise<AuthSession | null>> = (() => {
  const key = '__chutes_auth_refresh_locks__';
  const g = globalThis as unknown as Record<string, unknown>;
  if (g[key] && g[key] instanceof Map) return g[key] as Map<string, Promise<AuthSession | null>>;
  const m = new Map<string, Promise<AuthSession | null>>();
  g[key] = m;
  return m;
})();

export async function upsertUserFromUserInfo(userInfo: ChutesIdpUserInfo) {
  const existing = await db.query.users.findFirst({
    where: eq(users.id, userInfo.sub),
  });

  const nowIso = new Date().toISOString();
  if (!existing) {
    await db
      .insert(users)
      .values({
        id: userInfo.sub,
        username: userInfo.username ?? null,
        createdAt: userInfo.created_at ?? nowIso,
        updatedAt: nowIso,
      })
      .execute();
  } else {
    await db
      .update(users)
      .set({
        username: userInfo.username ?? existing.username,
        updatedAt: nowIso,
      })
      .where(eq(users.id, userInfo.sub))
      .execute();
  }
}

export async function createAuthSession(params: {
  userInfo: ChutesIdpUserInfo;
  token: ChutesIdpTokenResponse;
}): Promise<string> {
  const secret = getChutesAuthSecret();
  const sessionId = crypto.randomBytes(32).toString('hex');

  await upsertUserFromUserInfo(params.userInfo);

  const accessTokenExpiresAt =
    typeof params.token.expires_in === 'number'
      ? nowSeconds() + params.token.expires_in
      : null;

  await db
    .insert(authSessions)
    .values({
      id: sessionId,
      userId: params.userInfo.sub,
      createdAt: new Date().toISOString(),
      expiresAt: nowSeconds() + SESSION_LIFETIME_SECONDS,
      accessTokenEnc: sealString(params.token.access_token, secret),
      refreshTokenEnc: params.token.refresh_token
        ? sealString(params.token.refresh_token, secret)
        : null,
      accessTokenExpiresAt,
      scope: params.token.scope?.trim() || null,
      tokenType: params.token.token_type ?? null,
    })
    .execute();

  return sessionId;
}

export async function deleteAuthSession(sessionId: string) {
  await db.delete(authSessions).where(eq(authSessions.id, sessionId)).execute();
}

export async function getAuthSessionById(
  sessionId: string,
): Promise<AuthSession | null> {
  const row = await db.query.authSessions.findFirst({
    where: eq(authSessions.id, sessionId),
  });
  if (!row) return null;

  if (row.expiresAt < nowSeconds()) {
    await deleteAuthSession(sessionId);
    return null;
  }

  // Sliding expiration: keep sessions alive for 30 days after last successful usage.
  const now = nowSeconds();
  const remaining = row.expiresAt - now;
  // Avoid writing on every request; bump expiry when less than ~29 days remain.
  const refreshWindow = SESSION_LIFETIME_SECONDS - 24 * 60 * 60;
  if (remaining < refreshWindow) {
    const nextExpiresAt = now + SESSION_LIFETIME_SECONDS;
    await db
      .update(authSessions)
      .set({ expiresAt: nextExpiresAt })
      .where(eq(authSessions.id, sessionId))
      .execute();
  }

  const user = await db.query.users.findFirst({ where: eq(users.id, row.userId) });
  if (!user) {
    await deleteAuthSession(sessionId);
    return null;
  }

  // Sessions are encrypted-at-rest with CHUTES_AUTH_SECRET (or NEXTAUTH_SECRET).
  // If the secret is rotated or the ciphertext is corrupted, treat the session
  // as invalid instead of crashing the entire request.
  let accessToken: string;
  let refreshToken: string | null = null;
  let secret: string;
  try {
    secret = getChutesAuthSecret();
    accessToken = unsealString(row.accessTokenEnc, secret);
    refreshToken = row.refreshTokenEnc ? unsealString(row.refreshTokenEnc, secret) : null;
  } catch (err) {
    console.warn('[auth] Failed to decrypt auth session; deleting it.', err);
    try {
      await deleteAuthSession(sessionId);
    } catch {
      // ignore
    }
    return null;
  }

  return {
    sessionId: row.id,
    user: { id: user.id, username: user.username ?? null },
    accessToken,
    refreshToken,
    accessTokenExpiresAt: row.accessTokenExpiresAt ?? null,
    scope: row.scope?.trim() || null,
    tokenType: row.tokenType ?? null,
  };
}

export async function refreshAuthSessionIfNeeded(
  sessionId: string,
  bufferSeconds = 60,
): Promise<AuthSession | null> {
  let session: AuthSession | null = null;
  try {
    session = await getAuthSessionById(sessionId);
  } catch (err) {
    console.warn('[auth] Failed to load auth session.', err);
    return null;
  }
  if (!session) return null;

  const exp = session.accessTokenExpiresAt;
  if (!exp) return session;
  if (exp > nowSeconds() + bufferSeconds) return session;

  if (!session.refreshToken) {
    // No refresh token means we cannot extend the session. If the access token is
    // already expired (or about to), treat this as logged-out so callers don't
    // think the user is signed in but then fail to invoke.
    if (exp <= nowSeconds()) {
      try {
        await deleteAuthSession(sessionId);
      } catch {
        // ignore
      }
      return null;
    }
    return session;
  }

  if (refreshLocks.has(sessionId)) {
    return await refreshLocks.get(sessionId)!;
  }

  const refreshPromise = (async (): Promise<AuthSession | null> => {
    try {
      const { clientId, clientSecret } = await getChutesIdpClientCredentials();
      const refreshed = await refreshChutesAccessToken({
        refreshToken: session.refreshToken!,
        clientId,
        clientSecret,
      });

      const secret = getChutesAuthSecret();
      const accessTokenExpiresAt =
        typeof refreshed.expires_in === 'number'
          ? nowSeconds() + refreshed.expires_in
          : null;

      const refreshedScope = refreshed.scope?.trim() || null;
      const updateValues: Partial<typeof authSessions.$inferInsert> = {
        accessTokenEnc: sealString(refreshed.access_token, secret),
        accessTokenExpiresAt,
        // Some providers return an empty string for scope on refresh.
        // Never overwrite a previously-known scope with an empty value.
        scope: refreshedScope ?? session.scope,
        tokenType: refreshed.token_type ?? session.tokenType,
      };
      if (refreshed.refresh_token) {
        updateValues['refreshTokenEnc'] = sealString(refreshed.refresh_token, secret);
      }

      await db
        .update(authSessions)
        .set(updateValues)
        .where(eq(authSessions.id, sessionId))
        .execute();

      const updated = await getAuthSessionById(sessionId);
      if (!updated) return null;

      // Opportunistically refresh username if it changed.
      try {
        const userInfo = await fetchChutesUserInfo(updated.accessToken);
        await upsertUserFromUserInfo(userInfo);
        const withUser = await getAuthSessionById(sessionId);
        return withUser;
      } catch {
        return updated;
      }
    } catch (err) {
      // Refresh can fail if another concurrent request already rotated the
      // refresh token. Re-read the session from the DB to see if we now have
      // a fresh access token.
      try {
        const latest = await getAuthSessionById(sessionId);
        if (latest) {
          const latestExp = latest.accessTokenExpiresAt;
          const latestValid = latestExp
            ? latestExp > nowSeconds() + bufferSeconds
            : true;
          if (latestValid) return latest;
        }
      } catch {
        // ignore
      }

      // If our current access token is still valid enough for callers (>= 30s),
      // keep the session and let the next request attempt a refresh again.
      const currentExp = session.accessTokenExpiresAt;
      const currentStillUsable = currentExp
        ? currentExp > nowSeconds() + 30
        : true;
      if (currentStillUsable) return session;

      // If we still can't obtain a usable access token, treat as logged out.
      try {
        await deleteAuthSession(sessionId);
      } catch {
        // ignore
      }
      return null;
    } finally {
      refreshLocks.delete(sessionId);
    }
  })();

  refreshLocks.set(sessionId, refreshPromise);
  return await refreshPromise;
}
