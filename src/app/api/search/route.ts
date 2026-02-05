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
  getClientIp,
  checkIpRateLimit,
  incrementIpSearchCount,
} from '@/lib/rateLimit';

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
  chutesAccessToken?: string; // Optional Chutes OAuth token for authenticated users
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

    // Check if user is authenticated with Chutes
    const isAuthenticated = !!body.chutesAccessToken;

    // If not authenticated, check IP-based rate limit
    if (!isAuthenticated) {
      const clientIp = getClientIp(req);
      const { allowed, remaining, used } = await checkIpRateLimit(clientIp);

      if (!allowed) {
        return Response.json(
          {
            message: 'Free search limit reached',
            error: 'RATE_LIMIT_EXCEEDED',
            details: {
              used,
              remaining,
              limit: 3,
              requiresLogin: true,
            },
          },
          { status: 429 },
        );
      }

      // Increment the search count for this IP (before processing to prevent abuse)
      await incrementIpSearchCount(clientIp);
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
      const optimizationModels: Record<string, { provider: string; model: string }> = {
        // GPT-OSS 20B: Fast and efficient model for speed mode
        'speed': { provider: 'custom_openai', model: 'openai/gpt-oss-20b' },
        'balanced': { provider: 'custom_openai', model: 'deepseek-ai/DeepSeek-V3.1' },
        // Kimi K2.5 TEE: Most powerful model for quality mode
        'quality': { provider: 'custom_openai', model: 'moonshotai/Kimi-K2.5-TEE' }
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
      const apiKey = body.chatModel?.customOpenAIKey || getCustomOpenaiApiKey();
      const baseURL =
        body.chatModel?.customOpenAIBaseURL || getCustomOpenaiApiUrl();
      const primaryModelName =
        body.chatModel?.name || chatModel || getCustomOpenaiModelName();
      const fallbackModelNames = [
        'openai/gpt-oss-120b-TEE',
        'deepseek-ai/DeepSeek-V3',
        'zai-org/GLM-4.7-TEE',
        'deepseek-ai/DeepSeek-V3.2-TEE',
      ];
      const chutesCandidates = buildChutesCandidates({
        modelNames: [primaryModelName, ...fallbackModelNames],
        apiKey,
        baseURL,
      });
      const deepResearchSummaryModels = [
        'moonshotai/Kimi-K2.5-TEE',
        'deepseek-ai/DeepSeek-V3.2-TEE',
        'zai-org/GLM-4.7-TEE',
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

    logTiming(`Starting search with focusMode=${body.focusMode}, optimizationMode=${body.optimizationMode}, query="${body.query.substring(0, 50)}..."`);
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
