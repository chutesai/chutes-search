import { getLocalChats } from '@/lib/localStorage';

export const GET = async (req: Request) => {
  try {
    // Use local storage instead of shared database
    const chats = getLocalChats();
    return Response.json({ chats: chats }, { status: 200 });
  } catch (err) {
    console.error('Error in getting chats: ', err);
    return Response.json(
      { message: 'Failed to load chat history. Please try refreshing the page.' },
      { status: 500 },
    );
  }
};

export const DELETE = async (req: Request) => {
  try {
    const { searchParams } = new URL(req.url);
    const chatId = searchParams.get('chatId');
    
    if (!chatId) {
      return Response.json(
        { message: 'Chat ID is required' },
        { status: 400 },
      );
    }
    
    // For local storage, we can't delete from server-side
    // This endpoint is kept for compatibility but won't work with local storage
    return Response.json(
      { message: 'Chat deletion must be handled client-side with local storage' },
      { status: 400 },
    );
  } catch (err) {
    console.error('Error in deleting chat: ', err);
    return Response.json(
      { message: 'Failed to delete chat' },
      { status: 500 },
    );
  }
};
