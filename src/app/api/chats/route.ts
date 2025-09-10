import db from '@/lib/db';
import { cookies } from 'next/headers';

export const GET = async (req: Request) => {
  try {
    const cookieStore = await cookies();
    const sessionId = cookieStore.get('sessionId')?.value;

    let chats = await db.query.chats.findMany();
    if (sessionId) {
      chats = chats.filter((c: any) => c.sessionId === sessionId);
    }
    chats = chats.reverse();
    return Response.json({ chats: chats }, { status: 200 });
  } catch (err) {
    console.error('Error in getting chats: ', err);
    return Response.json(
      { message: 'An error has occurred.' },
      { status: 500 },
    );
  }
};
