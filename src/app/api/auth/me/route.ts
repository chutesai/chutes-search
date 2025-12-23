import { cookies } from 'next/headers';
import { AUTH_SESSION_COOKIE_NAME } from '@/lib/auth/constants';
import { refreshAuthSessionIfNeeded } from '@/lib/auth/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = async () => {
  const startTime = Date.now();
  console.log(`[auth/me] ${new Date().toISOString()} - Checking auth session`);
  
  const cookieStore = await cookies();
  const sessionId = cookieStore.get(AUTH_SESSION_COOKIE_NAME)?.value;
  
  if (!sessionId) {
    console.log(`[auth/me] ${new Date().toISOString()} - No session cookie found (${Date.now() - startTime}ms)`);
    return Response.json({ user: null }, { status: 200 });
  }

  console.log(`[auth/me] ${new Date().toISOString()} - Found session cookie: ${sessionId.substring(0, 8)}...`);
  
  const session = await refreshAuthSessionIfNeeded(sessionId);
  
  if (!session) {
    console.log(`[auth/me] ${new Date().toISOString()} - Session not found or expired, clearing cookie (${Date.now() - startTime}ms)`);
    cookieStore.set(AUTH_SESSION_COOKIE_NAME, '', {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 0,
    });
    return Response.json({ user: null }, { status: 200 });
  }

  console.log(`[auth/me] ${new Date().toISOString()} - Session valid for user: ${session.user.username || session.user.id} (${Date.now() - startTime}ms)`);
  
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

