// Local storage utility for per-user chat management
const CHATS_STORAGE_KEY = 'chutes_search_chats';
const SESSION_STORAGE_KEY = 'chutes_search_session';

export interface LocalChat {
  id: string;
  title: string;
  createdAt: string;
  focusMode: string;
  messages?: any[];
}

export const getSessionId = (): string => {
  if (typeof window === 'undefined') return '';
  
  let sessionId = localStorage.getItem(SESSION_STORAGE_KEY);
  if (!sessionId) {
    sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    localStorage.setItem(SESSION_STORAGE_KEY, sessionId);
  }
  return sessionId;
};

export const getLocalChats = (): LocalChat[] => {
  if (typeof window === 'undefined') return [];
  
  try {
    const stored = localStorage.getItem(CHATS_STORAGE_KEY);
    if (!stored) return [];
    
    const parsed = JSON.parse(stored);
    // Validate that it's an array and contains valid chat objects
    if (!Array.isArray(parsed)) return [];
    
    return parsed.filter((chat: any) =>
      chat &&
      typeof chat === 'object' &&
      typeof chat.id === 'string' &&
      typeof chat.title === 'string' &&
      typeof chat.createdAt === 'string' &&
      typeof chat.focusMode === 'string'
    );
  } catch (error) {
    console.error('Error reading local chats:', error);
    // Clear corrupted data
    try {
      localStorage.removeItem(CHATS_STORAGE_KEY);
    } catch (e) {
      console.error('Error clearing corrupted chat data:', e);
    }
    return [];
  }
};

export const saveLocalChat = (chat: LocalChat): void => {
  if (typeof window === 'undefined') return;
  
  try {
    // Validate chat object before saving
    if (!chat || typeof chat !== 'object') {
      throw new Error('Invalid chat object');
    }
    if (!chat.id || typeof chat.id !== 'string') {
      throw new Error('Invalid chat ID');
    }
    if (!chat.title || typeof chat.title !== 'string') {
      throw new Error('Invalid chat title');
    }
    if (!chat.createdAt || typeof chat.createdAt !== 'string') {
      throw new Error('Invalid chat createdAt');
    }
    if (!chat.focusMode || typeof chat.focusMode !== 'string') {
      throw new Error('Invalid chat focusMode');
    }
    
    const chats = getLocalChats();
    const existingIndex = chats.findIndex(c => c.id === chat.id);
    
    if (existingIndex >= 0) {
      chats[existingIndex] = chat;
    } else {
      chats.unshift(chat);
      // Limit to 100 chats to prevent localStorage from getting too large
      if (chats.length > 100) {
        chats.splice(100);
      }
    }
    
    localStorage.setItem(CHATS_STORAGE_KEY, JSON.stringify(chats));
  } catch (error) {
    console.error('Error saving local chat:', error);
    // Don't propagate error to avoid breaking the UI
  }
};

export const deleteLocalChat = (chatId: string): void => {
  if (typeof window === 'undefined') return;
  
  try {
    const chats = getLocalChats();
    const filteredChats = chats.filter(c => c.id !== chatId);
    localStorage.setItem(CHATS_STORAGE_KEY, JSON.stringify(filteredChats));
  } catch (error) {
    console.error('Error deleting local chat:', error);
  }
};

export const clearLocalChats = (): void => {
  if (typeof window === 'undefined') return;
  
  try {
    localStorage.removeItem(CHATS_STORAGE_KEY);
  } catch (error) {
    console.error('Error clearing local chats:', error);
  }
};