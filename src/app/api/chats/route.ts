import { getAuthSession } from '@/lib/auth/cookieSession';
import db from '@/lib/db';
import { chats } from '@/lib/db/schema';
import { desc, eq } from 'drizzle-orm';
import { cookies } from 'next/headers';
import {
  ANON_SESSION_COOKIE_NAME,
} from '@/lib/auth/constants';
import { decryptField } from '@/lib/crypto/fieldEncryption';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = async (req: Request) => {
  try {
    const cookieStore = await cookies();
    const authSession = await getAuthSession(cookieStore);

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

    const userId = authSession?.user.id ?? null;
    return Response.json({
      chats: rows.map((r) => ({ ...r, title: decryptField(r.title, userId) })),
    }, { status: 200 });
  } catch (err) {
    console.error('Error in getting chats: ', err);
    return Response.json(
      { message: 'Failed to load chat history. Please try refreshing the page.' },
      { status: 500 },
    );
  }
};

// Deletion is handled via `/api/chats/:id`.
