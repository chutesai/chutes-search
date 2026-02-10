import { getAuthSession } from '@/lib/auth/cookieSession';
import crypto from 'crypto';
import { AIMessage, BaseMessage, HumanMessage } from '@langchain/core/messages';
import { EventEmitter } from 'stream';
import {
  getAvailableChatModelProviders,
  getAvailableEmbeddingModelProviders,
} from '@/lib/providers';
import db from '@/lib/db';
import { cookies } from 'next/headers';
import { chats, messages as messagesSchema } from '@/lib/db/schema';
import { and, eq, gt } from 'drizzle-orm';
import { getFileDetails } from '@/lib/utils/files';
import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import {
  getCustomOpenaiApiKey,
  getCustomOpenaiApiUrl,
  getCustomOpenaiModelName,
} from '@/lib/config';
import { searchHandlers } from '@/lib/search';
import { buildChutesCandidates, LlmCandidate } from '@/lib/llm/fallbacks';
import {
  ANON_SESSION_COOKIE_NAME,
} from '@/lib/auth/constants';
import {
  consumeFreeSearchQuota,
} from '@/lib/rateLimit';
import { encryptField } from '@/lib/crypto/fieldEncryption';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Message = {
  messageId: string;
  chatId: string;
  content: string;
};

type ChatModel = {
  provider: string;
  name: string;
};

type EmbeddingModel = {
  provider: string;
  name: string;
};

type Body = {
  message: Message;
  optimizationMode: 'speed' | 'balanced' | 'quality';
  focusMode: string;
  deepResearchMode?: 'light' | 'max';
  history: Array<[string, string]>;
  files: Array<string>;
  chatModel: ChatModel;
  embeddingModel: EmbeddingModel;
  systemInstructions: string;
};

const handleEmitterEvents = async (
  stream: EventEmitter,
  writer: WritableStreamDefaultWriter,
  encoder: TextEncoder,
  aiMessageId: string,
  chatId: string,
  userId: string | null,
) => {
  let recievedMessage = '';
  let sources: any[] = [];
  let closed = false;

  const safeWrite = (payload: unknown) => {
    if (closed) return;
    try {
      void writer.write(encoder.encode(JSON.stringify(payload) + '\n')).catch(() => {
        closed = true;
      });
    } catch {
      closed = true;
    }
  };

  const safeClose = () => {
    if (closed) return;
    closed = true;
    try {
      void writer.close().catch(() => {});
    } catch {
      // ignore
    }
    stream.removeAllListeners('data');
    stream.removeAllListeners('end');
    stream.removeAllListeners('error');
  };

  stream.on('data', (data) => {
    const parsedData = JSON.parse(data);
    if (parsedData.type === 'response') {
      safeWrite({
        type: 'message',
        data: parsedData.data,
        messageId: aiMessageId,
      });

      recievedMessage += parsedData.data;
    } else if (parsedData.type === 'sources') {
      safeWrite({
        type: 'sources',
        data: parsedData.data,
        messageId: aiMessageId,
      });

      sources = parsedData.data;
    } else if (parsedData.type === 'progress') {
      safeWrite({
        type: 'progress',
        data: parsedData.data,
        messageId: aiMessageId,
      });
    }
  });
  stream.on('end', () => {
    if (closed) return;
    safeWrite({
      type: 'messageEnd',
      messageId: aiMessageId,
    });
    safeClose();

    db.insert(messagesSchema)
      .values({
        content: encryptField(recievedMessage, userId),
        chatId: chatId,
        messageId: aiMessageId,
        role: 'assistant',
        metadata: JSON.stringify({
          createdAt: new Date(),
          ...(sources && sources.length > 0 && { sources }),
        }),
      })
      .execute();
  });
  stream.on('error', (data) => {
    const parsedData = JSON.parse(data);
    if (closed) return;
    safeWrite({ type: 'error', data: parsedData.data });
    safeClose();
  });
};

const handleHistorySave = async (
  message: Message,
  humanMessageId: string,
  focusMode: string,
  files: string[],
  owner: { sessionId: string; userId: string | null },
) => {
  const chat = await db.query.chats.findFirst({
    where: eq(chats.id, message.chatId),
  });

  const fileData = files.map(getFileDetails);

  if (!chat) {
    await db
      .insert(chats)
      .values({
        id: message.chatId,
        title: encryptField(message.content, owner.userId),
        createdAt: new Date().toISOString(),
        focusMode: focusMode,
        sessionId: owner.sessionId,
        userId: owner.userId,
        files: fileData,
      })
      .execute();
  } else {
    const needsUserIdBackfill = !chat.userId && owner.userId;
    const needsFilesUpdate =
      JSON.stringify(chat.files ?? []) != JSON.stringify(fileData);

    if (needsUserIdBackfill || needsFilesUpdate) {
      await db
        .update(chats)
        .set({
          ...(needsUserIdBackfill ? { userId: owner.userId } : {}),
          ...(needsFilesUpdate ? { files: fileData } : {}),
        })
        .where(eq(chats.id, message.chatId))
        .execute();
    }
  }

  const messageExists = await db.query.messages.findFirst({
    where: eq(messagesSchema.messageId, humanMessageId),
  });

  if (!messageExists) {
    await db
      .insert(messagesSchema)
      .values({
        content: encryptField(message.content, owner.userId),
        chatId: message.chatId,
        messageId: humanMessageId,
        role: 'user',
        metadata: JSON.stringify({
          createdAt: new Date(),
        }),
      })
      .execute();
  } else {
    await db
      .delete(messagesSchema)
      .where(
        and(
          gt(messagesSchema.id, messageExists.id),
          eq(messagesSchema.chatId, message.chatId),
        ),
      )
      .execute();
  }
};

export const POST = async (req: Request) => {
  const requestStart = Date.now();
  const log = (step: string) => console.log(`[chat] ${new Date().toISOString()} | +${Date.now() - requestStart}ms | ${step}`);
  
  try {
    log('Request received');
    const cookieStore = await cookies();
    let sessionId = cookieStore.get(ANON_SESSION_COOKIE_NAME)?.value;
    if (!sessionId) {
      sessionId = crypto.randomBytes(16).toString('hex');
      cookieStore.set(ANON_SESSION_COOKIE_NAME, sessionId, {
        path: '/',
        sameSite: 'lax',
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        maxAge: 30 * 24 * 60 * 60,
      });
    }

    const authSession = await getAuthSession(cookieStore);

    const body = (await req.json()) as Body;
    const { message } = body;

    if (message.content === '') {
      return Response.json(
        {
          type: 'error',
          data: 'Please provide a message to process',
          message: 'Please provide a message to process',
        },
        { status: 400 },
      );
    }

    // Check if user is authenticated (server-side session cookie only).
    // Do not trust auth tokens supplied in the request body.
    const isAuthenticated = !!authSession;

    // Deep Research is only available to signed-in users.
    if (body.focusMode === 'deepResearch' && !isAuthenticated) {
      return Response.json(
        {
          type: 'error',
          data: 'Deep Research requires signing in with Chutes',
          message: 'Deep Research requires signing in with Chutes',
          error: 'DEEP_RESEARCH_REQUIRES_LOGIN',
          details: {
            requiresLogin: true,
          },
        },
        { status: 401 },
      );
    }

    // If not authenticated, check IP-based rate limit
    if (!isAuthenticated) {
      const quota = await consumeFreeSearchQuota(req);
      if (!quota.allowed) {
        if (quota.reason === 'ip_daily') {
          return Response.json(
            {
              type: 'error',
              data: 'Free search limit reached',
              message: 'Free search limit reached',
              error: 'RATE_LIMIT_EXCEEDED',
              details: {
                used: quota.used,
                remaining: quota.remaining,
                limit: 3,
                requiresLogin: true,
              },
            },
            { status: 429 },
          );
        }

        // Global throttles: keep the app safe under load/DDOS.
        return Response.json(
          {
            type: 'error',
            data: 'Too many free searches right now. Please try again soon.',
            message: 'Too many free searches right now. Please try again soon.',
            error: 'FREE_SEARCH_GLOBAL_RATE_LIMIT',
          },
          { status: 429 },
        );
      }
    }

    log('Auth check complete, loading model providers');
    const [chatModelProviders, embeddingModelProviders] = await Promise.all([
      getAvailableChatModelProviders(),
      getAvailableEmbeddingModelProviders(),
    ]);
    log('Model providers loaded');

    // Determine model based on optimization mode (if using Chutes/custom_openai).
    // Note: Some models may have different response formats; keep fallbacks configured.
    const optimizationModels: Record<string, string> = {
      'speed': 'Qwen/Qwen3-Next-80B-A3B-Instruct',
      'balanced': 'moonshotai/Kimi-K2.5-TEE',
      'quality': 'moonshotai/Kimi-K2.5-TEE',
    };

    const isChutesProvider = body.chatModel?.provider === 'custom_openai' || !body.chatModel?.provider;
    const optimizedModelName = isChutesProvider && body.optimizationMode
      ? optimizationModels[body.optimizationMode]
      : null;

    const chatModelProvider =
      chatModelProviders[
        body.chatModel?.provider || Object.keys(chatModelProviders)[0]
      ];
    const chatModel =
      chatModelProvider[
        body.chatModel?.name || Object.keys(chatModelProvider)[0]
      ];

    const embeddingProvider =
      embeddingModelProviders[
        body.embeddingModel?.provider || Object.keys(embeddingModelProviders)[0]
      ];
    const embeddingModel =
      embeddingProvider[
        body.embeddingModel?.name || Object.keys(embeddingProvider)[0]
      ];

    let llm: BaseChatModel | undefined;
    let llmCandidates: LlmCandidate[] | undefined;
    let embedding = embeddingModel.model;

    // Use Chutes for custom_openai provider or when optimization mode is set
    if (body.chatModel?.provider === 'custom_openai' || (isChutesProvider && optimizedModelName)) {
      // Some token endpoints omit `scope` (or return it as an empty string) even when
      // the access token still has the expected permissions. Treat missing scope as
      // "unknown" and allow invoke; if the token truly lacks permission, the request
      // will fail and the user will be asked to sign in again.
      const scopeStr = authSession?.scope?.trim() || '';
      const hasInvoke =
        !scopeStr || scopeStr.split(/\s+/).includes('chutes:invoke');
      const tokenExpiry = authSession?.accessTokenExpiresAt ?? null;
      const tokenValid = tokenExpiry ? tokenExpiry > Math.floor(Date.now() / 1000) + 30 : true;
      const useUserToken = Boolean(authSession?.accessToken && hasInvoke && tokenValid);

      const baseURL = getCustomOpenaiApiUrl();
      // When a user is signed in, never fall back to the app key.
      if (isAuthenticated && !useUserToken) {
        return Response.json(
          {
            type: 'error',
            data:
              'Your session is missing permission to run inference. Please sign in again.',
            message:
              'Your session is missing permission to run inference. Please sign in again.',
            error: 'AUTH_INVOKE_REQUIRED',
          },
          { status: 401 },
        );
      }

      const apiKey = useUserToken ? authSession!.accessToken : getCustomOpenaiApiKey();
      // Use optimization mode model if available, otherwise use the requested model
      const primaryModelName = optimizedModelName || body.chatModel?.name || getCustomOpenaiModelName();
      log(`Using model: ${primaryModelName} (optimizationMode: ${body.optimizationMode})`);

      // Fallback models - prefer models that work reliably with structured prompts.
      const fallbackModelNames = [
        'deepseek-ai/DeepSeek-V3',
        'Qwen/Qwen2.5-72B-Instruct',
        'NousResearch/Hermes-4-70B',
      ];
      const chutesCandidates = buildChutesCandidates({
        modelNames: [primaryModelName, ...fallbackModelNames],
        apiKey,
        baseURL,
      });
      // Deep research MAX summary models - keep a stable set of high-quality fallbacks.
      const deepResearchSummaryModels = [
        'deepseek-ai/DeepSeek-V3',
        'Qwen/Qwen2.5-72B-Instruct',
        'NousResearch/Hermes-4-70B',
      ];
      const useDeepResearchSummary =
        body.focusMode === 'deepResearch' && body.deepResearchMode === 'max';

      llmCandidates = useDeepResearchSummary
        ? buildChutesCandidates({
            modelNames: deepResearchSummaryModels,
            apiKey,
            baseURL,
          })
        : chutesCandidates;

      llm = llmCandidates[0]?.model;
    } else if (chatModelProvider && chatModel) {
      llm = chatModel.model;
    }

    if (!llm) {
      return Response.json(
        {
          type: 'error',
          data: 'Invalid chat model',
          message: 'Invalid chat model',
          error: 'INVALID_CHAT_MODEL',
        },
        { status: 400 },
      );
    }

    if (!embedding) {
      return Response.json(
        {
          type: 'error',
          data: 'Invalid embedding model',
          message: 'Invalid embedding model',
          error: 'INVALID_EMBEDDING_MODEL',
        },
        { status: 400 },
      );
    }

    const humanMessageId =
      message.messageId ?? crypto.randomBytes(7).toString('hex');
    const aiMessageId = crypto.randomBytes(7).toString('hex');

    const history: BaseMessage[] = body.history.map((msg) => {
      if (msg[0] === 'human') {
        return new HumanMessage({
          content: msg[1],
        });
      } else {
        return new AIMessage({
          content: msg[1],
        });
      }
    });

    const handler = searchHandlers[body.focusMode];

    if (!handler) {
      return Response.json(
        {
          type: 'error',
          data: 'Invalid focus mode',
          message: 'Invalid focus mode',
        },
        { status: 400 },
      );
    }

    log(`Starting searchAndAnswer with focusMode=${body.focusMode}, optimizationMode=${body.optimizationMode}`);
    const stream = await handler.searchAndAnswer(
      message.content,
      history,
      llm,
      embedding,
      body.optimizationMode,
      body.files,
      body.systemInstructions,
      body.deepResearchMode,
      llmCandidates,
      { userAccessToken: authSession?.accessToken },
    );
    log('searchAndAnswer returned emitter, starting stream');

    const responseStream = new TransformStream();
    const writer = responseStream.writable.getWriter();
    const encoder = new TextEncoder();

    handleEmitterEvents(stream, writer, encoder, aiMessageId, message.chatId, authSession?.user.id ?? null);
    handleHistorySave(message, humanMessageId, body.focusMode, body.files, {
      sessionId,
      userId: authSession?.user.id ?? null,
    });

    return new Response(responseStream.readable, {
      headers: {
        'Content-Type': 'text/event-stream',
        Connection: 'keep-alive',
        'Cache-Control': 'no-cache, no-transform',
      },
    });
  } catch (err) {
    console.error('An error occurred while processing chat request:', err);
    return Response.json(
      {
        type: 'error',
        data: 'An error occurred while processing chat request',
        message: 'An error occurred while processing chat request',
      },
      { status: 500 },
    );
  }
};
