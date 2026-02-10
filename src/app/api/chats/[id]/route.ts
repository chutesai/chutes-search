import { getAuthSession } from '@/lib/auth/cookieSession';
import db from '@/lib/db';
import { chats, messages } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { cookies } from 'next/headers';
import {
  ANON_SESSION_COOKIE_NAME,
} from '@/lib/auth/constants';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = async (
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) => {
  try {
    const { id } = await params;

    const cookieStore = await cookies();
    const sessionId = cookieStore.get(ANON_SESSION_COOKIE_NAME)?.value || null;
    const authSessionId = cookieStore.get()?.value;
    const authSession = authSessionId
      ? await getAuthSessionById(authSessionId)
      : null;
    if (authSessionId && !authSession) {
      cookieStore.set('', {
        path: '/',
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        maxAge: 0,
      });
    }

    const chatExists = await db.query.chats.findFirst({
      where: eq(chats.id, id),
    });

    if (!chatExists) {
      return Response.json({ message: 'Chat not found' }, { status: 404 });
    }

    if (chatExists.userId) {
      if (!authSession || chatExists.userId !== authSession.user.id) {
        return Response.json({ message: 'Chat not found' }, { status: 404 });
      }
    } else {
      if (!sessionId || chatExists.sessionId !== sessionId) {
        return Response.json({ message: 'Chat not found' }, { status: 404 });
      }
    }

    const chatMessages = await db.query.messages.findMany({
      where: eq(messages.chatId, id),
    });

    return Response.json(
      {
        chat: chatExists,
        messages: chatMessages,
      },
      { status: 200 },
    );
  } catch (err) {
    console.error('Error in getting chat by id: ', err);
    return Response.json(
      { message: 'An error has occurred.' },
      { status: 500 },
    );
  }
};

export const DELETE = async (
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) => {
  try {
    const { id } = await params;

    const cookieStore = await cookies();
    const sessionId = cookieStore.get(ANON_SESSION_COOKIE_NAME)?.value || null;
    const authSessionId = cookieStore.get()?.value;
    const authSession = authSessionId
      ? await getAuthSessionById(authSessionId)
      : null;
    if (authSessionId && !authSession) {
      cookieStore.set('', {
        path: '/',
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        maxAge: 0,
      });
    }

    const chatExists = await db.query.chats.findFirst({
      where: eq(chats.id, id),
    });

    if (!chatExists) {
      return Response.json({ message: 'Chat not found' }, { status: 404 });
    }

    if (chatExists.userId) {
      if (!authSession || chatExists.userId !== authSession.user.id) {
        return Response.json({ message: 'Chat not found' }, { status: 404 });
      }
    } else {
      if (!sessionId || chatExists.sessionId !== sessionId) {
        return Response.json({ message: 'Chat not found' }, { status: 404 });
      }
    }

    await db.delete(chats).where(eq(chats.id, id)).execute();
    await db.delete(messages).where(eq(messages.chatId, id)).execute();

    return Response.json(
      { message: 'Chat deleted successfully' },
      { status: 200 },
    );
  } catch (err) {
    console.error('Error in deleting chat by id: ', err);
    return Response.json(
      { message: 'An error has occurred.' },
      { status: 500 },
    );
  }
};
