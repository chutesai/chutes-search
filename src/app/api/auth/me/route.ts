import { cookies } from 'next/headers';
import { AUTH_SESSION_COOKIE_NAME } from '@/lib/auth/constants';
import { refreshAuthSessionIfNeeded } from '@/lib/auth/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = async () => {
  try {
    const cookieStore = await cookies();
    const sessionId = cookieStore.get(AUTH_SESSION_COOKIE_NAME)?.value;

    if (!sessionId) {
      return Response.json({ user: null }, { status: 200 });
    }

    let session = null;
    try {
      session = await refreshAuthSessionIfNeeded(sessionId);
    } catch (err) {
      console.warn(
        '[auth/me] Failed to refresh auth session, clearing cookie.',
        err,
      );
      session = null;
    }

    if (!session) {
      cookieStore.set(AUTH_SESSION_COOKIE_NAME, '', {
        path: '/',
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        maxAge: 0,
      });
      return Response.json({ user: null }, { status: 200 });
    }

    // Refresh cookie expiry so the browser keeps the session for 30 days after last usage.
    cookieStore.set(AUTH_SESSION_COOKIE_NAME, sessionId, {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 30 * 24 * 60 * 60,
    });

    return Response.json(
      {
        user: {
          id: session.user.id,
          username: session.user.username,
        },
        scope: session.scope,
        hasInvoke: Boolean(session.scope?.split(' ').includes('chutes:invoke')),
      },
      { status: 200 },
    );
  } catch (err) {
    console.error('[auth/me] Unexpected error, treating as logged out.', err);
    return Response.json({ user: null }, { status: 200 });
  }
};
