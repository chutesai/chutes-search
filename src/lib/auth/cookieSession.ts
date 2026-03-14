/**
 * Cookie-based session storage for serverless environments (Vercel).
 *
 * Instead of storing session data in SQLite (which doesn't persist across
 * serverless function invocations), the full session is AES-256-GCM encrypted
 * and stored directly in the cookie.
 *
 * Cookie values prefixed with "cc5_" are fallback cookie-based sessions.
 * Plain session ids are DB-backed sessions and are the preferred format.
 */

import { type ReadonlyRequestCookies } from 'next/dist/server/web/spec-extension/adapters/request-cookies';
import { AUTH_SESSION_COOKIE_NAME } from './constants';
import { sealJson, unsealJson } from './seal';
import { getChutesAuthSecret } from './secret';
import {
  refreshChutesAccessToken,
  fetchChutesUserInfo,
  getChutesIdpClientCredentials,
} from './chutesIdp';
import {
  type AuthSession,
  refreshAuthSessionIfNeeded,
  upsertUserFromUserInfo,
  createAuthSession as dbCreateAuthSession,
} from './session';

export const COOKIE_SESSION_PREFIX = 'cc5_';

type CookieSessionPayload = {
  sid: string;
  uid: string;
  un: string | null;
  at: string;
  rt: string | null;
  exp: number | null;
  scope: string | null;
  tt: string | null;
};

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

export function sealSessionToCookie(session: AuthSession): string {
  const secret = getChutesAuthSecret();
  const payload: CookieSessionPayload = {
    sid: session.sessionId,
    uid: session.user.id,
    un: session.user.username,
    at: session.accessToken,
    rt: session.refreshToken,
    exp: session.accessTokenExpiresAt,
    scope: session.scope,
    tt: session.tokenType,
  };
  return COOKIE_SESSION_PREFIX + sealJson(payload, secret);
}

export function unsealSessionFromCookie(
  cookieValue: string,
): AuthSession | null {
  if (!cookieValue.startsWith(COOKIE_SESSION_PREFIX)) return null;
  try {
    const secret = getChutesAuthSecret();
    const payload = unsealJson<CookieSessionPayload>(
      cookieValue.slice(COOKIE_SESSION_PREFIX.length),
      secret,
    );
    return {
      sessionId: payload.sid,
      user: { id: payload.uid, username: payload.un },
      accessToken: payload.at,
      refreshToken: payload.rt,
      accessTokenExpiresAt: payload.exp,
      scope: payload.scope,
      tokenType: payload.tt,
    };
  } catch {
    return null;
  }
}

const SESSION_COOKIE_OPTS = {
  path: '/',
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: process.env.NODE_ENV === 'production',
  maxAge: 30 * 24 * 60 * 60,
};

function setCookie(cookieStore: ReadonlyRequestCookies, value: string) {
  (cookieStore as any).set(
    AUTH_SESSION_COOKIE_NAME,
    value,
    SESSION_COOKIE_OPTS,
  );
}

function clearCookie(cookieStore: ReadonlyRequestCookies) {
  (cookieStore as any).set(AUTH_SESSION_COOKIE_NAME, '', {
    ...SESSION_COOKIE_OPTS,
    maxAge: 0,
  });
}

/**
 * Resolve an auth session from the cookie store.
 * Handles both fallback cookie-based (cc5_...) and DB-based sessions.
 * Automatically refreshes expired access tokens and updates the cookie.
 */
export async function getAuthSession(
  cookieStore: ReadonlyRequestCookies,
): Promise<AuthSession | null> {
  const cookieValue = cookieStore.get(AUTH_SESSION_COOKIE_NAME)?.value;
  if (!cookieValue) return null;

  // --- Fallback cookie-based session ---
  if (cookieValue.startsWith(COOKIE_SESSION_PREFIX)) {
    let session = unsealSessionFromCookie(cookieValue);
    if (!session) {
      clearCookie(cookieStore);
      return null;
    }

    // Migrate legacy cookie-backed sessions to the preferred compact DB-backed
    // cookie whenever the DB row already exists.
    try {
      const dbSession = await refreshAuthSessionIfNeeded(session.sessionId);
      if (dbSession) {
        setCookie(cookieStore, dbSession.sessionId);
        return dbSession;
      }
    } catch {
      // If the lookup fails, keep using the fallback cookie session below.
    }

    // Check if access token needs refresh
    const exp = session.accessTokenExpiresAt;
    if (exp && exp <= nowSeconds() + 60) {
      if (!session.refreshToken) {
        if (exp <= nowSeconds()) {
          clearCookie(cookieStore);
          return null;
        }
        return session;
      }

      try {
        const { clientId, clientSecret } =
          await getChutesIdpClientCredentials();
        const refreshed = await refreshChutesAccessToken({
          refreshToken: session.refreshToken,
          clientId,
          clientSecret,
        });

        session = {
          ...session,
          accessToken: refreshed.access_token,
          refreshToken: refreshed.refresh_token ?? session.refreshToken,
          accessTokenExpiresAt:
            typeof refreshed.expires_in === 'number'
              ? nowSeconds() + refreshed.expires_in
              : null,
          scope: refreshed.scope?.trim() || session.scope,
          tokenType: refreshed.token_type ?? session.tokenType,
        };

        // Opportunistically update username
        try {
          const userInfo = await fetchChutesUserInfo(session.accessToken);
          session = {
            ...session,
            user: {
              ...session.user,
              username: userInfo.username ?? session.user.username,
            },
          };
        } catch {
          // ignore
        }

        setCookie(cookieStore, sealSessionToCookie(session));
      } catch {
        // If refresh fails but token still usable (>30s), keep going
        if (exp > nowSeconds() + 30) return session;
        clearCookie(cookieStore);
        return null;
      }
    }

    return session;
  }

  // --- Legacy DB-based session ---
  try {
    const session = await refreshAuthSessionIfNeeded(cookieValue);
    if (!session) {
      clearCookie(cookieStore);
      return null;
    }
    // Refresh cookie lifetime without inflating it with token payloads.
    setCookie(cookieStore, session.sessionId);
    return session;
  } catch {
    clearCookie(cookieStore);
    return null;
  }
}

/**
 * Create a new auth session and return the cookie value.
 * Prefer a compact DB-backed session id; fall back to a sealed cookie session
 * only when the DB write fails.
 */
export async function createSessionAndSeal(params: {
  userInfo: { sub: string; username?: string; created_at?: string };
  token: {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
    token_type?: string;
  };
}): Promise<string> {
  try {
    return await dbCreateAuthSession({
      userInfo: params.userInfo,
      token: params.token,
    });
  } catch {
    const sessionId = require('crypto').randomBytes(32).toString('hex');
    // Still try to upsert the user for chats association
    try {
      await upsertUserFromUserInfo(params.userInfo);
    } catch {
      // ignore
    }

    const session: AuthSession = {
      sessionId,
      user: {
        id: params.userInfo.sub,
        username: params.userInfo.username ?? null,
      },
      accessToken: params.token.access_token,
      refreshToken: params.token.refresh_token ?? null,
      accessTokenExpiresAt:
        typeof params.token.expires_in === 'number'
          ? nowSeconds() + params.token.expires_in
          : null,
      scope: params.token.scope?.trim() || null,
      tokenType: params.token.token_type ?? null,
    };

    return sealSessionToCookie(session);
  }
}
