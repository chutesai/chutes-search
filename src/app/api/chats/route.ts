import db from '@/lib/db';
import { chats } from '@/lib/db/schema';
import { desc, eq } from 'drizzle-orm';
import { cookies } from 'next/headers';
import {
  ANON_SESSION_COOKIE_NAME,
  AUTH_SESSION_COOKIE_NAME,
} from '@/lib/auth/constants';
import { getAuthSessionById } from '@/lib/auth/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = async (req: Request) => {
  try {
    const cookieStore = await cookies();
    const authSessionId = cookieStore.get(AUTH_SESSION_COOKIE_NAME)?.value;
    const authSession = authSessionId
      ? await getAuthSessionById(authSessionId)
      : null;
    if (authSessionId && !authSession) {
      cookieStore.set(AUTH_SESSION_COOKIE_NAME, '', {
        path: '/',
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        maxAge: 0,
      });
    }

    const sessionId = cookieStore.get(ANON_SESSION_COOKIE_NAME)?.value;
    const where = authSession
      ? eq(chats.userId, authSession.user.id)
      : sessionId
        ? eq(chats.sessionId, sessionId)
        : null;

    if (!where) return Response.json({ chats: [] }, { status: 200 });

    const rows = await db
      .select({
        id: chats.id,
        title: chats.title,
        createdAt: chats.createdAt,
        focusMode: chats.focusMode,
      })
      .from(chats)
      .where(where)
      .orderBy(desc(chats.createdAt))
      .execute();

    return Response.json({ chats: rows }, { status: 200 });
  } catch (err) {
    console.error('Error in getting chats: ', err);
    return Response.json(
      { message: 'Failed to load chat history. Please try refreshing the page.' },
      { status: 500 },
    );
  }
};

// Deletion is handled via `/api/chats/:id`.
