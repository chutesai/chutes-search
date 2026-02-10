import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { AUTH_SESSION_COOKIE_NAME } from '@/lib/auth/constants';
import { getRequestOrigin, getSafeReturnTo } from '@/lib/auth/request';
import { deleteAuthSession } from '@/lib/auth/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = async (req: Request) => {
  const url = new URL(req.url);
  const origin = getRequestOrigin(req);
  const returnTo = getSafeReturnTo(
    url.searchParams.get('returnTo') || url.searchParams.get('redirect'),
  );

  const cookieStore = await cookies();
  const sessionId = cookieStore.get(AUTH_SESSION_COOKIE_NAME)?.value;

  if (sessionId) {
    try {
      await deleteAuthSession(sessionId);
    } catch {
      // Cookie-based sessions have no DB row to delete; ignore.
    }
  }

  cookieStore.set(AUTH_SESSION_COOKIE_NAME, '', {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 0,
  });

  return NextResponse.redirect(new URL(returnTo, origin));
};

