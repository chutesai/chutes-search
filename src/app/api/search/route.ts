import { getAuthSession } from '@/lib/auth/cookieSession';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { Embeddings } from '@langchain/core/embeddings';
import {
  getAvailableChatModelProviders,
  getAvailableEmbeddingModelProviders,
} from '@/lib/providers';
import { AIMessage, BaseMessage, HumanMessage } from '@langchain/core/messages';
import { MetaSearchAgentType } from '@/lib/search/metaSearchAgent';
import {
  getCustomOpenaiApiKey,
  getCustomOpenaiApiUrl,
  getCustomOpenaiModelName,
} from '@/lib/config';
import { searchHandlers } from '@/lib/search';
import { buildChutesCandidates, LlmCandidate } from '@/lib/llm/fallbacks';
import {
  consumeFreeSearchQuota,
} from '@/lib/rateLimit';
import { cookies } from 'next/headers';

interface chatModel {
  provider: string;
  name: string;
  customOpenAIKey?: string;
  customOpenAIBaseURL?: string;
}

interface embeddingModel {
  provider: string;
  name: string;
}

interface ChatRequestBody {
  optimizationMode: 'speed' | 'balanced' | 'quality';
  focusMode: string;
  deepResearchMode?: 'light' | 'max';
  chatModel?: chatModel;
  embeddingModel?: embeddingModel;
  query: string;
  history: Array<[string, string]>;
  stream?: boolean;
  systemInstructions?: string;
}

export const POST = async (req: Request) => {
  const requestStartTime = Date.now();
  const logTiming = (step: string) => {
    console.log(`[search] ${new Date().toISOString()} | +${Date.now() - requestStartTime}ms | ${step}`);
  };
  
  try {
    logTiming('Request received');
    const body: ChatRequestBody = await req.json();
    logTiming('Body parsed');

    if (!body.focusMode || !body.query) {
      return Response.json(
        { message: 'Missing focus mode or query' },
        { status: 400 },
      );
    }

    const cookieStore = await cookies();
    const authSession = await getAuthSession(cookieStore);

    // Check if user is authenticated (server-side session cookie only).
    const isAuthenticated = !!authSession;

    // Deep Research is only available to signed-in users.
    if (body.focusMode === 'deepResearch' && !isAuthenticated) {
      return Response.json(
        {
          message: 'Deep Research requires signing in with Chutes',
          error: 'DEEP_RESEARCH_REQUIRES_LOGIN',
          details: { requiresLogin: true },
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

        return Response.json(
          {
            message: 'Too many free searches right now. Please try again soon.',
            error: 'FREE_SEARCH_GLOBAL_RATE_LIMIT',
          },
          { status: 429 },
        );
      }
    }

    body.history = body.history || [];
    // Keep default to the previously working 'balanced' key
    body.optimizationMode = body.optimizationMode || 'balanced';
    body.stream = body.stream || false;

    const history: BaseMessage[] = body.history.map((msg) => {
      return msg[0] === 'human'
        ? new HumanMessage({ content: msg[1] })
        : new AIMessage({ content: msg[1] });
    });

    logTiming('Starting to load model providers');
    const [chatModelProviders, embeddingModelProviders] = await Promise.all([
      getAvailableChatModelProviders(),
      getAvailableEmbeddingModelProviders(),
    ]);
    logTiming('Model providers loaded');

    let chatModelProvider =
      body.chatModel?.provider || Object.keys(chatModelProviders)[0];
    let chatModel =
      body.chatModel?.name ||
      Object.keys(chatModelProviders[chatModelProvider])[0];

    // Override model based on optimization mode
    if (body.optimizationMode) {
      // Note: Some models may have different response formats; keep fallbacks configured.
      const optimizationModels: Record<string, { provider: string; model: string }> = {
        'speed': { provider: 'custom_openai', model: 'Qwen/Qwen3-Next-80B-A3B-Instruct' },
        'balanced': { provider: 'custom_openai', model: 'moonshotai/Kimi-K2.5-TEE' },
        'quality': { provider: 'custom_openai', model: 'moonshotai/Kimi-K2.5-TEE' },
      };

      const optimizedModel = optimizationModels[body.optimizationMode];
      if (optimizedModel) {
        // For custom_openai (Chutes), we can use any model directly without checking the provider map
        // since Chutes dynamically supports all available models
        if (optimizedModel.provider === 'custom_openai') {
          chatModelProvider = optimizedModel.provider;
          chatModel = optimizedModel.model;
          console.log(`Using optimized model for ${body.optimizationMode}: ${optimizedModel.model}`);
        } else if (chatModelProviders[optimizedModel.provider]) {
          // For other providers, check if the specific model exists
          if (chatModelProviders[optimizedModel.provider][optimizedModel.model]) {
            chatModelProvider = optimizedModel.provider;
            chatModel = optimizedModel.model;
            console.log(`Using optimized model for ${body.optimizationMode}: ${optimizedModel.provider}/${optimizedModel.model}`);
          } else {
            console.log(`Optimized model ${optimizedModel.provider}/${optimizedModel.model} not available, using default`);
          }
        } else {
          console.log(`Optimized model provider ${optimizedModel.provider} not available, using default`);
        }
      }
    }

    const embeddingModelProvider =
      body.embeddingModel?.provider || Object.keys(embeddingModelProviders)[0];
    const embeddingModel =
      body.embeddingModel?.name ||
      Object.keys(embeddingModelProviders[embeddingModelProvider])[0];

    let llm: BaseChatModel | undefined;
    let llmCandidates: LlmCandidate[] | undefined;
    let embeddings: Embeddings | undefined;

    const isCustomOpenai =
      body.chatModel?.provider === 'custom_openai' ||
      chatModelProvider === 'custom_openai';

    if (isCustomOpenai) {
      const scopeStr = authSession?.scope?.trim() || '';
      const hasInvoke =
        !scopeStr || scopeStr.split(/\s+/).includes('chutes:invoke');
      const tokenExpiry = authSession?.accessTokenExpiresAt ?? null;
      const tokenValid = tokenExpiry
        ? tokenExpiry > Math.floor(Date.now() / 1000) + 30
        : true;
      const useUserToken = Boolean(
        authSession?.accessToken && hasInvoke && tokenValid,
      );

      // When signed in, never fall back to the app CHUTES_API_KEY.
      if (isAuthenticated && !body.chatModel?.customOpenAIKey && !useUserToken) {
        return Response.json(
          {
            message:
              'Your session is missing permission to run inference. Please sign in again.',
            error: 'AUTH_INVOKE_REQUIRED',
          },
          { status: 401 },
        );
      }

      const apiKey = body.chatModel?.customOpenAIKey
        ? body.chatModel.customOpenAIKey
        : isAuthenticated
          ? authSession!.accessToken
          : getCustomOpenaiApiKey();
      const baseURL =
        body.chatModel?.customOpenAIBaseURL || getCustomOpenaiApiUrl();
      const primaryModelName =
        body.chatModel?.name || chatModel || getCustomOpenaiModelName();
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
    } else if (
      chatModelProviders[chatModelProvider] &&
      chatModelProviders[chatModelProvider][chatModel]
    ) {
      llm = chatModelProviders[chatModelProvider][chatModel]
        .model as unknown as BaseChatModel | undefined;
    }

    if (
      embeddingModelProviders[embeddingModelProvider] &&
      embeddingModelProviders[embeddingModelProvider][embeddingModel]
    ) {
      embeddings = embeddingModelProviders[embeddingModelProvider][
        embeddingModel
      ].model as Embeddings | undefined;
    }

    if (!llm || !embeddings) {
      return Response.json(
        { message: 'Invalid model selected' },
        { status: 400 },
      );
    }

    const searchHandler: MetaSearchAgentType = searchHandlers[body.focusMode];

    if (!searchHandler) {
      return Response.json({ message: 'Invalid focus mode' }, { status: 400 });
    }

    logTiming(
      `Starting search with focusMode=${body.focusMode}, optimizationMode=${body.optimizationMode}, queryLen=${body.query.length}`,
    );
    const emitter = await searchHandler.searchAndAnswer(
      body.query,
      history,
      llm,
      embeddings,
      body.optimizationMode,
      [],
      body.systemInstructions || '',
      body.deepResearchMode,
      llmCandidates,
      { userAccessToken: authSession?.accessToken },
    );
    logTiming('Search handler returned emitter');

    if (!body.stream) {
      return new Promise(
        (
          resolve: (value: Response) => void,
          reject: (value: Response) => void,
        ) => {
          let message = '';
          let sources: any[] = [];

          emitter.on('data', (data: string) => {
            try {
              const parsedData = JSON.parse(data);
              if (parsedData.type === 'response') {
                message += parsedData.data;
              } else if (parsedData.type === 'sources') {
                sources = parsedData.data;
              } else if (parsedData.type === 'progress') {
                // Progress updates are ignored for non-streaming responses.
              }
            } catch (error) {
              reject(
                Response.json(
                  { message: 'Error parsing data' },
                  { status: 500 },
                ),
              );
            }
          });

          emitter.on('end', () => {
            resolve(Response.json({ message, sources }, { status: 200 }));
          });

          emitter.on('error', (error: any) => {
            reject(
              Response.json(
                { message: 'Search error', error },
                { status: 500 },
              ),
            );
          });
        },
      );
    }

    const encoder = new TextEncoder();

    const abortController = new AbortController();
    const { signal } = abortController;

    const stream = new ReadableStream({
      start(controller) {
        let sources: any[] = [];

        controller.enqueue(
          encoder.encode(
            JSON.stringify({
              type: 'init',
              data: 'Stream connected',
            }) + '\n',
          ),
        );

        signal.addEventListener('abort', () => {
          emitter.removeAllListeners();

          try {
            controller.close();
          } catch (error) {}
        });

        emitter.on('data', (data: string) => {
          if (signal.aborted) return;

          try {
            const parsedData = JSON.parse(data);

            if (parsedData.type === 'response') {
              controller.enqueue(
                encoder.encode(
                  JSON.stringify({
                    type: 'response',
                    data: parsedData.data,
                  }) + '\n',
                ),
              );
            } else if (parsedData.type === 'sources') {
              sources = parsedData.data;
              controller.enqueue(
                encoder.encode(
                  JSON.stringify({
                    type: 'sources',
                    data: sources,
                  }) + '\n',
                ),
              );
            } else if (parsedData.type === 'progress') {
              controller.enqueue(
                encoder.encode(
                  JSON.stringify({
                    type: 'progress',
                    data: parsedData.data,
                  }) + '\n',
                ),
              );
            }
          } catch (error) {
            controller.error(error);
          }
        });

        emitter.on('end', () => {
          if (signal.aborted) return;

          controller.enqueue(
            encoder.encode(
              JSON.stringify({
                type: 'done',
              }) + '\n',
            ),
          );
          controller.close();
        });

        emitter.on('error', (error: any) => {
          if (signal.aborted) return;

          controller.error(error);
        });
      },
      cancel() {
        abortController.abort();
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
      },
    });
  } catch (err: any) {
    console.error(`Error in getting search results: ${err.message}`);
    return Response.json(
      { message: 'An error has occurred.' },
      { status: 500 },
    );
  }
};
