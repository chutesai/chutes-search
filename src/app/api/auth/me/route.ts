import { cookies } from 'next/headers';
import { AUTH_SESSION_COOKIE_NAME } from '@/lib/auth/constants';
import { refreshAuthSessionIfNeeded } from '@/lib/auth/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = async () => {
  const cookieStore = await cookies();
  const sessionId = cookieStore.get(AUTH_SESSION_COOKIE_NAME)?.value;
  if (!sessionId) {
    return Response.json({ user: null }, { status: 200 });
  }

  const session = await refreshAuthSessionIfNeeded(sessionId);
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
};

