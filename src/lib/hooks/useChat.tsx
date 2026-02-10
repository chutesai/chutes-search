'use client';

import { Message } from '@/components/ChatWindow';
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import crypto from 'crypto';
import { useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import { Document } from '@langchain/core/documents';
import { getSuggestions } from '../actions';
import {
  FREE_SEARCH_LIMIT,
  incrementFreeSearchState,
  readFreeSearchState,
} from '@/lib/freeSearch';

type ChatContext = {
  messages: Message[];
  chatHistory: [string, string][];
  files: File[];
  fileIds: string[];
  focusMode: string;
  deepResearchMode: 'light' | 'max';
  chatId: string | undefined;
  optimizationMode: string;
  isMessagesLoaded: boolean;
  loading: boolean;
  notFound: boolean;
  messageAppeared: boolean;
  isReady: boolean;
  hasError: boolean;
  setOptimizationMode: (mode: string) => void;
  setFocusMode: (mode: string) => void;
  setDeepResearchMode: (mode: 'light' | 'max') => void;
  setFiles: (files: File[]) => void;
  setFileIds: (fileIds: string[]) => void;
  sendMessage: (
    message: string,
    messageId?: string,
    rewrite?: boolean,
  ) => Promise<void>;
  rewrite: (messageId: string) => void;

  freeSearchGate: {
    open: boolean;
    count: number;
    limit: number;
    pendingQuery?: string;
    reason?: 'quota' | 'session';
  };
  closeFreeSearchGate: () => void;
};

export interface File {
  fileName: string;
  fileExtension: string;
  fileId: string;
}

interface ChatModelProvider {
  name: string;
  provider: string;
}

interface EmbeddingModelProvider {
  name: string;
  provider: string;
}

type AuthMe = {
  user: { id: string; username: string | null } | null;
  hasInvoke?: boolean;
};

const checkConfig = async (
  setChatModelProvider: (provider: ChatModelProvider) => void,
  setEmbeddingModelProvider: (provider: EmbeddingModelProvider) => void,
  setIsConfigReady: (ready: boolean) => void,
  setHasError: (hasError: boolean) => void,
) => {
  try {
    let chatModel = localStorage.getItem('chatModel');
    let chatModelProvider = localStorage.getItem('chatModelProvider');
    let embeddingModel = localStorage.getItem('embeddingModel');
    let embeddingModelProvider = localStorage.getItem('embeddingModelProvider');

    const autoImageSearch = localStorage.getItem('autoImageSearch');
    const autoVideoSearch = localStorage.getItem('autoVideoSearch');

    if (!autoImageSearch) {
      localStorage.setItem('autoImageSearch', 'true');
    }

    if (!autoVideoSearch) {
      localStorage.setItem('autoVideoSearch', 'false');
    }

    const providers = await fetch(`/api/models`, {
      headers: {
        'Content-Type': 'application/json',
      },
    }).then(async (res) => {
      if (!res.ok)
        throw new Error(
          `Failed to fetch models: ${res.status} ${res.statusText}`,
        );
      return res.json();
    });

    if (
      !chatModel ||
      !chatModelProvider ||
      !embeddingModel ||
      !embeddingModelProvider
    ) {
      if (!chatModel || !chatModelProvider) {
        const chatModelProviders = providers.chatModelProviders;
        const chatModelProvidersKeys = Object.keys(chatModelProviders);

        if (!chatModelProviders || chatModelProvidersKeys.length === 0) {
          return toast.error('No chat models available');
        } else {
          chatModelProvider =
            chatModelProvidersKeys.find(
              (provider) =>
                Object.keys(chatModelProviders[provider]).length > 0,
            ) || chatModelProvidersKeys[0];
        }

        if (
          chatModelProvider === 'custom_openai' &&
          Object.keys(chatModelProviders[chatModelProvider]).length === 0
        ) {
          toast.error(
            "Looks like you haven't configured any chat model providers. Please configure them from the settings page or the config file.",
          );
          return setHasError(true);
        }

        chatModel = Object.keys(chatModelProviders[chatModelProvider])[0];
      }

      if (!embeddingModel || !embeddingModelProvider) {
        const embeddingModelProviders = providers.embeddingModelProviders;

        if (
          !embeddingModelProviders ||
          Object.keys(embeddingModelProviders).length === 0
        )
          return toast.error('No embedding models available');

        embeddingModelProvider = Object.keys(embeddingModelProviders)[0];
        embeddingModel = Object.keys(
          embeddingModelProviders[embeddingModelProvider],
        )[0];
      }

      localStorage.setItem('chatModel', chatModel!);
      localStorage.setItem('chatModelProvider', chatModelProvider);
      localStorage.setItem('embeddingModel', embeddingModel!);
      localStorage.setItem('embeddingModelProvider', embeddingModelProvider);
    } else {
      const chatModelProviders = providers.chatModelProviders;
      const embeddingModelProviders = providers.embeddingModelProviders;

      if (
        Object.keys(chatModelProviders).length > 0 &&
        (!chatModelProviders[chatModelProvider] ||
          Object.keys(chatModelProviders[chatModelProvider]).length === 0)
      ) {
        const chatModelProvidersKeys = Object.keys(chatModelProviders);
        chatModelProvider =
          chatModelProvidersKeys.find(
            (key) => Object.keys(chatModelProviders[key]).length > 0,
          ) || chatModelProvidersKeys[0];

        localStorage.setItem('chatModelProvider', chatModelProvider);
      }

      if (
        chatModelProvider &&
        !chatModelProviders[chatModelProvider][chatModel]
      ) {
        if (
          chatModelProvider === 'custom_openai' &&
          Object.keys(chatModelProviders[chatModelProvider]).length === 0
        ) {
          toast.error(
            "Looks like you haven't configured any chat model providers. Please configure them from the settings page or the config file.",
          );
          return setHasError(true);
        }

        chatModel = Object.keys(
          chatModelProviders[
            Object.keys(chatModelProviders[chatModelProvider]).length > 0
              ? chatModelProvider
              : Object.keys(chatModelProviders)[0]
          ],
        )[0];

        localStorage.setItem('chatModel', chatModel);
      }

      if (
        Object.keys(embeddingModelProviders).length > 0 &&
        !embeddingModelProviders[embeddingModelProvider]
      ) {
        embeddingModelProvider = Object.keys(embeddingModelProviders)[0];
        localStorage.setItem('embeddingModelProvider', embeddingModelProvider);
      }

      if (
        embeddingModelProvider &&
        !embeddingModelProviders[embeddingModelProvider][embeddingModel]
      ) {
        embeddingModel = Object.keys(
          embeddingModelProviders[embeddingModelProvider],
        )[0];
        localStorage.setItem('embeddingModel', embeddingModel);
      }
    }

    setChatModelProvider({
      name: chatModel!,
      provider: chatModelProvider,
    });

    setEmbeddingModelProvider({
      name: embeddingModel!,
      provider: embeddingModelProvider,
    });

    setIsConfigReady(true);
  } catch (err) {
    console.error('An error occurred while checking the configuration:', err);
    setIsConfigReady(false);
    setHasError(true);
  }
};

const loadMessages = async (
  chatId: string,
  setMessages: (messages: Message[]) => void,
  setIsMessagesLoaded: (loaded: boolean) => void,
  setChatHistory: (history: [string, string][]) => void,
  setFocusMode: (mode: string) => void,
  setNotFound: (notFound: boolean) => void,
  setFiles: (files: File[]) => void,
  setFileIds: (fileIds: string[]) => void,
) => {
  const res = await fetch(`/api/chats/${chatId}`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
    },
  });

  if (res.status === 404) {
    setNotFound(true);
    setIsMessagesLoaded(true);
    return;
  }

  const data = await res.json();

  const messages = data.messages.map((msg: any) => {
    return {
      ...msg,
      ...JSON.parse(msg.metadata),
    };
  }) as Message[];

  setMessages(messages);

  const history = messages.map((msg) => {
    return [msg.role, msg.content];
  }) as [string, string][];

  console.debug(new Date(), 'app:messages_loaded');

  document.title = `${messages[0].content} - Chutes Search`;

  const files = data.chat.files.map((file: any) => {
    return {
      fileName: file.name,
      fileExtension: file.name.split('.').pop(),
      fileId: file.fileId,
    };
  });

  setFiles(files);
  setFileIds(files.map((file: File) => file.fileId));

  setChatHistory(history);
  setFocusMode(data.chat.focusMode);
  setIsMessagesLoaded(true);
};

export const chatContext = createContext<ChatContext>({
  chatHistory: [],
  chatId: '',
  fileIds: [],
  files: [],
  focusMode: '',
  deepResearchMode: 'light',
  hasError: false,
  isMessagesLoaded: false,
  isReady: false,
  loading: false,
  messageAppeared: false,
  messages: [],
  notFound: false,
  optimizationMode: '',
  rewrite: () => {},
  sendMessage: async () => {},
  setFileIds: () => {},
  setFiles: () => {},
  setFocusMode: () => {},
  setDeepResearchMode: () => {},
  setOptimizationMode: () => {},
  freeSearchGate: { open: false, count: 0, limit: FREE_SEARCH_LIMIT },
  closeFreeSearchGate: () => {},
});

export const ChatProvider = ({
  children,
  id,
}: {
  children: React.ReactNode;
  id?: string;
}) => {
  const searchParams = useSearchParams();
  const initialMessage = searchParams.get('q');

  const [chatId, setChatId] = useState<string | undefined>(id);
  const [newChatCreated, setNewChatCreated] = useState(false);

  const [loading, setLoading] = useState(false);
  const [messageAppeared, setMessageAppeared] = useState(false);

  const [chatHistory, setChatHistory] = useState<[string, string][]>([]);
  const [messages, setMessages] = useState<Message[]>([]);

  const [files, setFiles] = useState<File[]>([]);
  const [fileIds, setFileIds] = useState<string[]>([]);

  const [focusMode, setFocusMode] = useState('webSearch');
  const [optimizationMode, setOptimizationMode] = useState('speed');
  const [deepResearchMode, setDeepResearchMode] = useState<'light' | 'max'>(
    'light',
  );

  const [isMessagesLoaded, setIsMessagesLoaded] = useState(false);

  const [notFound, setNotFound] = useState(false);

  const [chatModelProvider, setChatModelProvider] = useState<ChatModelProvider>(
    {
      name: '',
      provider: '',
    },
  );

  const [embeddingModelProvider, setEmbeddingModelProvider] =
    useState<EmbeddingModelProvider>({
      name: '',
      provider: '',
    });

  const [isConfigReady, setIsConfigReady] = useState(false);
  const [hasError, setHasError] = useState(false);
  const [isReady, setIsReady] = useState(false);

  const [authMe, setAuthMe] = useState<AuthMe>({ user: null });
  const [isAuthLoaded, setIsAuthLoaded] = useState(false);

  const refreshAuth = useCallback(async (): Promise<AuthMe> => {
    let data: AuthMe = { user: null };
    try {
      const res = await fetch('/api/auth/me', { cache: 'no-store' });
      data = (await res.json()) as AuthMe;
    } catch {
      data = { user: null };
    }
    setAuthMe(data);
    setIsAuthLoaded(true);
    return data;
  }, []);

  useEffect(() => {
    refreshAuth();
  }, [refreshAuth]);

  const [freeSearchGate, setFreeSearchGate] = useState<ChatContext['freeSearchGate']>({
    open: false,
    count: 0,
    limit: FREE_SEARCH_LIMIT,
    pendingQuery: undefined,
    reason: 'quota',
  });

  const closeFreeSearchGate = useCallback(() => {
    setFreeSearchGate((prev) => ({ ...prev, open: false }));
  }, []);

  const messagesRef = useRef<Message[]>([]);

  useEffect(() => {
    checkConfig(
      setChatModelProvider,
      setEmbeddingModelProvider,
      setIsConfigReady,
      setHasError,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (
      chatId &&
      !newChatCreated &&
      !isMessagesLoaded &&
      messages.length === 0
    ) {
      loadMessages(
        chatId,
        setMessages,
        setIsMessagesLoaded,
        setChatHistory,
        setFocusMode,
        setNotFound,
        setFiles,
        setFileIds,
      );
    } else if (!chatId) {
      setNewChatCreated(true);
      setIsMessagesLoaded(true);
      setChatId(crypto.randomBytes(20).toString('hex'));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    if (isMessagesLoaded && isConfigReady) {
      setIsReady(true);
      console.debug(new Date(), 'app:ready');
    } else {
      setIsReady(false);
    }
  }, [isMessagesLoaded, isConfigReady]);

  const rewrite = (messageId: string) => {
    const index = messages.findIndex((msg) => msg.messageId === messageId);

    if (index === -1) return;

    const message = messages[index - 1];

    setMessages((prev) => {
      return [...prev.slice(0, messages.length > 2 ? index - 1 : 0)];
    });
    setChatHistory((prev) => {
      return [...prev.slice(0, messages.length > 2 ? index - 1 : 0)];
    });

    sendMessage(message.content, message.messageId, true);
  };

  useEffect(() => {
    if (isReady && initialMessage && isConfigReady) {
      if (!isConfigReady) {
        toast.error('Cannot send message before the configuration is ready');
        return;
      }
      sendMessage(initialMessage);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isConfigReady, isReady, initialMessage]);

  const sendMessage: ChatContext['sendMessage'] = async (
    message,
    messageId,
    rewrite = false,
  ) => {
    if (loading) return;

    const trimmed = message.trim();
    if (!trimmed) return;

    if (!rewrite) {
      const me = isAuthLoaded ? authMe : await refreshAuth();
      const isSignedIn = Boolean(me.user);

      if (focusMode === 'deepResearch' && !isSignedIn) {
        toast.error('Sign in with Chutes to use Deep Research.');
        return;
      }

      if (!isSignedIn) {
        try {
          const current = readFreeSearchState(localStorage);
          if (current.count >= FREE_SEARCH_LIMIT) {
            setFreeSearchGate({
              open: true,
              count: current.count,
              limit: FREE_SEARCH_LIMIT,
              pendingQuery: trimmed,
              reason: 'quota',
            });
            return;
          }

          incrementFreeSearchState(localStorage);
        } catch {
          // If localStorage is unavailable, default to allowing the request.
        }
      }
    }

    setLoading(true);
    setMessageAppeared(false);

    let sources: Document[] | undefined = undefined;
    let recievedMessage = '';
    let added = false;

    messageId = messageId ?? crypto.randomBytes(7).toString('hex');

    setMessages((prevMessages) => [
      ...prevMessages,
      {
        content: trimmed,
        messageId: messageId,
        chatId: chatId!,
        role: 'user',
        createdAt: new Date(),
      },
    ]);

    const messageHandler = async (data: any) => {
      if (data.type === 'error') {
        toast.error(data.data);
        setLoading(false);
        return;
      }

      if (data.type === 'progress') {
        type ProgressItem = NonNullable<Message['progress']>[number];
        const progressUpdate = data.data as ProgressItem;

        const mergeProgress = (
          current: NonNullable<Message['progress']> = [],
          update: ProgressItem,
        ) => {
          const next = [...current];
          const index = next.findIndex((item) => item.id === update.id);
          if (index >= 0) {
            next[index] = { ...next[index], ...update };
          } else {
            next.push(update);
          }
          return next;
        };

        if (!added) {
          setMessages((prevMessages) => [
            ...prevMessages,
            {
              content: '',
              messageId: data.messageId,
              chatId: chatId!,
              role: 'assistant',
              sources: sources,
              progress: [progressUpdate],
              createdAt: new Date(),
            },
          ]);
          added = true;
        }

        setMessages((prev) =>
          prev.map((message) => {
            if (message.messageId === data.messageId) {
              return {
                ...message,
                progress: mergeProgress(message.progress, progressUpdate),
              };
            }
            return message;
          }),
        );

        setMessageAppeared(true);
        return;
      }

      if (data.type === 'sources') {
        sources = data.data;
        if (!added) {
          setMessages((prevMessages) => [
            ...prevMessages,
            {
              content: '',
              messageId: data.messageId,
              chatId: chatId!,
              role: 'assistant',
              sources: sources,
              createdAt: new Date(),
            },
          ]);
          added = true;
        }
        setMessages((prev) =>
          prev.map((message) => {
            if (message.messageId === data.messageId) {
              return { ...message, sources: sources };
            }
            return message;
          }),
        );
        setMessageAppeared(true);
      }

      if (data.type === 'message') {
        if (!added) {
          setMessages((prevMessages) => [
            ...prevMessages,
            {
              content: data.data,
              messageId: data.messageId,
              chatId: chatId!,
              role: 'assistant',
              sources: sources,
              createdAt: new Date(),
            },
          ]);
          added = true;
        }

        setMessages((prev) =>
          prev.map((message) => {
            if (message.messageId === data.messageId) {
              return { ...message, content: message.content + data.data };
            }

            return message;
          }),
        );

        recievedMessage += data.data;
        setMessageAppeared(true);
      }

      if (data.type === 'messageEnd') {
        // If the backend didn't emit completion events for every progress item,
        // stop any spinners so the UI reflects that the answer is finished.
        setMessages((prev) =>
          prev.map((msg) => {
            if (msg.messageId !== data.messageId) return msg;
            if (!msg.progress || msg.progress.length === 0) return msg;
            return {
              ...msg,
              progress: msg.progress.map((item) => {
                if (item.status !== 'running') return item;
                return {
                  ...item,
                  status: 'complete',
                  ...(typeof item.percent === 'number' ? { percent: 100 } : {}),
                };
              }),
            };
          }),
        );

        setChatHistory((prevHistory) => [
          ...prevHistory,
          ['human', trimmed],
          ['assistant', recievedMessage],
        ]);

        setLoading(false);

        const lastMsg = messagesRef.current[messagesRef.current.length - 1];

        const autoImageSearch = localStorage.getItem('autoImageSearch');
        const autoVideoSearch = localStorage.getItem('autoVideoSearch');

        if (autoImageSearch === 'true') {
          document
            .getElementById(`search-images-${lastMsg.messageId}`)
            ?.click();
        }

        if (autoVideoSearch === 'true') {
          document
            .getElementById(`search-videos-${lastMsg.messageId}`)
            ?.click();
        }

        if (
          lastMsg.role === 'assistant' &&
          lastMsg.sources &&
          lastMsg.sources.length > 0 &&
          !lastMsg.suggestions
        ) {
          const suggestions = await getSuggestions(messagesRef.current);
          setMessages((prev) =>
            prev.map((msg) => {
              if (msg.messageId === lastMsg.messageId) {
                return { ...msg, suggestions: suggestions };
              }
              return msg;
            }),
          );
        }
      }
    };

    const messageIndex = messages.findIndex((m) => m.messageId === messageId);

    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        content: trimmed,
        message: {
          messageId: messageId,
          chatId: chatId!,
          content: trimmed,
        },
        chatId: chatId!,
        files: fileIds,
        focusMode: focusMode,
        deepResearchMode: focusMode === 'deepResearch' ? deepResearchMode : undefined,
        optimizationMode: optimizationMode,
        history: rewrite
          ? chatHistory.slice(0, messageIndex === -1 ? undefined : messageIndex)
          : chatHistory,
        chatModel: {
          name: chatModelProvider.name,
          provider: chatModelProvider.provider,
        },
        embeddingModel: {
          name: embeddingModelProvider.name,
          provider: embeddingModelProvider.provider,
        },
        systemInstructions: localStorage.getItem('systemInstructions'),
      }),
    });

    if (!res.ok) {
      let payload: any = null;
      try {
        payload = await res.clone().json();
      } catch {
        payload = null;
      }

      if (res.status === 429 && payload?.error === 'RATE_LIMIT_EXCEEDED') {
        // Server-side quota enforcement (IP-based) can be stricter/more accurate than localStorage.
        // Show the sign-in gate dialog so the UI doesn't get stuck waiting for stream events.
        const used = typeof payload?.details?.used === 'number' ? payload.details.used : FREE_SEARCH_LIMIT;
        const limit = typeof payload?.details?.limit === 'number' ? payload.details.limit : FREE_SEARCH_LIMIT;
        setFreeSearchGate({
          open: true,
          count: Math.min(used, limit),
          limit,
          pendingQuery: trimmed,
          reason: 'quota',
        });
      }

      if (res.status === 401 && payload?.error === 'AUTH_INVOKE_REQUIRED') {
        setFreeSearchGate({
          open: true,
          count: 0,
          limit: FREE_SEARCH_LIMIT,
          pendingQuery: trimmed,
          reason: 'session',
        });
        setLoading(false);
        return;
      }

      const message =
        payload?.message ||
        payload?.error ||
        `Request failed (${res.status})`;
      toast.error(String(message));
      setLoading(false);
      return;
    }

    if (!res.body) throw new Error('No response body');

    const reader = res.body.getReader();
    const decoder = new TextDecoder('utf-8');

    let buffer = '';
    const handleJson = (json: any) => messageHandler(json);

    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });

      let newlineIndex = buffer.indexOf('\n');
      while (newlineIndex >= 0) {
        const line = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);
        newlineIndex = buffer.indexOf('\n');

        if (!line) continue;
        try {
          const json = JSON.parse(line);
          handleJson(json);
        } catch (error) {
          console.warn('Failed to parse stream line, skipping.', {
            preview: line.slice(0, 200),
          });
        }
      }
    }

    if (buffer.trim()) {
      try {
        const json = JSON.parse(buffer);
        handleJson(json);
      } catch (error) {
        console.warn('Trailing stream data could not be parsed.');
      }
    }
  };

  return (
    <chatContext.Provider
      value={{
        messages,
        chatHistory,
        files,
        fileIds,
        focusMode,
        deepResearchMode,
        chatId,
        hasError,
        isMessagesLoaded,
        isReady,
        loading,
        messageAppeared,
        notFound,
        optimizationMode,
        setFileIds,
        setFiles,
        setFocusMode,
        setDeepResearchMode,
        setOptimizationMode,
        rewrite,
        sendMessage,
        freeSearchGate,
        closeFreeSearchGate,
      }}
    >
      {children}
    </chatContext.Provider>
  );
};

export const useChat = () => {
  const ctx = useContext(chatContext);
  return ctx;
};
