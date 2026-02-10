import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import {
  exchangeChutesAuthorizationCode,
  fetchChutesUserInfo,
  getChutesIdpClientCredentials,
} from '@/lib/auth/chutesIdp';
import {
  ANON_SESSION_COOKIE_NAME,
  AUTH_SESSION_COOKIE_NAME,
  OAUTH_STATE_COOKIE_NAME,
} from '@/lib/auth/constants';
import { createSessionAndSeal } from '@/lib/auth/cookieSession';
import { getRequestOrigin, getSafeReturnTo } from '@/lib/auth/request';
import { getChutesAuthSecret } from '@/lib/auth/secret';
import { unsealJson } from '@/lib/auth/seal';
import db from '@/lib/db';
import { chats } from '@/lib/db/schema';
import { and, eq, isNull } from 'drizzle-orm';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type OAuthStatePayload = {
  state: string;
  codeVerifier: string;
  returnTo?: string;
  createdAt?: number;
};

export const GET = async (req: Request) => {
  const url = new URL(req.url);
  const origin = getRequestOrigin(req);

  const error = url.searchParams.get('error');
  const errorDescription = url.searchParams.get('error_description');
  if (error) {
    const message = errorDescription ? `${error}: ${errorDescription}` : error;
    return NextResponse.redirect(new URL(`/?authError=${encodeURIComponent(message)}`, origin));
  }

  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  if (!code || !state) {
    return Response.json({ error: 'Missing code/state' }, { status: 400 });
  }

  const cookieStore = await cookies();
  const sealedState = cookieStore.get(OAUTH_STATE_COOKIE_NAME)?.value;
  if (!sealedState) {
    return Response.json({ error: 'Missing OAuth state cookie' }, { status: 400 });
  }

  let parsed: OAuthStatePayload;
  try {
    parsed = unsealJson<OAuthStatePayload>(sealedState, getChutesAuthSecret());
  } catch {
    return Response.json({ error: 'Invalid OAuth state cookie' }, { status: 400 });
  }

  if (parsed.state !== state) {
    return Response.json({ error: 'OAuth state mismatch' }, { status: 400 });
  }

  try {
    const redirectUri =
      process.env.CHUTES_IDP_REDIRECT_URI || `${origin}/api/auth/callback`;
    const { clientId, clientSecret } = await getChutesIdpClientCredentials({
      redirectUri,
    });

    const token = await exchangeChutesAuthorizationCode({
      code,
      redirectUri,
      codeVerifier: parsed.codeVerifier,
      clientId,
      clientSecret,
    });

    const userInfo = await fetchChutesUserInfo(token.access_token);
    const sealedSession = await createSessionAndSeal({ userInfo, token });

    cookieStore.set(AUTH_SESSION_COOKIE_NAME, sealedSession, {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 30 * 24 * 60 * 60,
    });

    // Clear one-time OAuth cookie.
    cookieStore.set(OAUTH_STATE_COOKIE_NAME, '', {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 0,
    });

    const anonSessionId = cookieStore.get(ANON_SESSION_COOKIE_NAME)?.value;
    if (anonSessionId) {
      await db
        .update(chats)
        .set({ userId: userInfo.sub })
        .where(and(eq(chats.sessionId, anonSessionId), isNull(chats.userId)))
        .execute();
    }

    const returnTo = getSafeReturnTo(parsed.returnTo || '/');
    return NextResponse.redirect(new URL(returnTo, origin));
  } catch (err) {
    console.error('IDP callback error:', err);
    return Response.json({ error: 'Login failed' }, { status: 500 });
  }
};
