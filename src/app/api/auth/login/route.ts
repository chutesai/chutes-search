import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import {
  CHUTES_IDP_DEFAULT_SCOPES,
  buildChutesAuthorizationUrl,
  getChutesIdpClientCredentials,
} from '@/lib/auth/chutesIdp';
import { AUTH_SESSION_COOKIE_NAME, OAUTH_STATE_COOKIE_NAME } from '@/lib/auth/constants';
import { generateOAuthState, generatePkcePair } from '@/lib/auth/pkce';
import { getRequestOrigin, getSafeReturnTo } from '@/lib/auth/request';
import { sealJson } from '@/lib/auth/seal';
import { getChutesAuthSecret } from '@/lib/auth/secret';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = async (req: Request) => {
  try {
    const url = new URL(req.url);
    const returnTo = getSafeReturnTo(
      url.searchParams.get('returnTo') || url.searchParams.get('redirect'),
    );

    const origin = getRequestOrigin(req);
    const redirectUri =
      process.env.CHUTES_IDP_REDIRECT_URI || `${origin}/api/auth/callback`;

    const { clientId } = await getChutesIdpClientCredentials({ redirectUri });
    const { codeVerifier, codeChallenge } = generatePkcePair();
    const state = generateOAuthState();

    const secret = getChutesAuthSecret();
    const sealed = sealJson(
      {
        state,
        codeVerifier,
        returnTo,
        createdAt: Date.now(),
      },
      secret,
    );

    const cookieStore = await cookies();

    // Clear any existing session before starting a fresh flow.
    if (cookieStore.get(AUTH_SESSION_COOKIE_NAME)?.value) {
      cookieStore.set(AUTH_SESSION_COOKIE_NAME, '', {
        path: '/',
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        maxAge: 0,
      });
    }

    cookieStore.set(OAUTH_STATE_COOKIE_NAME, sealed, {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 10 * 60,
    });

    const authorizationUrl = buildChutesAuthorizationUrl({
      clientId,
      redirectUri,
      scopes: CHUTES_IDP_DEFAULT_SCOPES,
      state,
      codeChallenge,
    });

    return NextResponse.redirect(authorizationUrl);
  } catch (err) {
    console.error('IDP login error:', err);
    return Response.json(
      {
        type: 'error',
        data: 'Failed to start login flow',
        error: 'FAILED_TO_START_LOGIN_FLOW',
      },
      { status: 500 },
    );
  }
};
