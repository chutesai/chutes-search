import { cookies } from 'next/headers';
import { getAuthSession } from '@/lib/auth/cookieSession';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = async () => {
  try {
    const cookieStore = await cookies();
    const session = await getAuthSession(cookieStore);

    if (!session) {
      return Response.json({ user: null }, { status: 200 });
    }

    return Response.json(
      {
        user: {
          id: session.user.id,
          username: session.user.username,
        },
        scope: session.scope,
        hasInvoke:
          !(session.scope?.trim()) ||
          session.scope.trim().split(/\s+/).includes('chutes:invoke'),
      },
      { status: 200 },
    );
  } catch (err) {
    console.error('[auth/me] Unexpected error, treating as logged out.', err);
    return Response.json({ user: null }, { status: 200 });
  }
};
