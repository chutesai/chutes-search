import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { Embeddings } from '@langchain/core/embeddings';
import { getAvailableEmbeddingModelProviders } from '@/lib/providers';
import { buildChutesCandidates } from '@/lib/llm/fallbacks';
import {
  getCustomOpenaiApiUrl,
  getCustomOpenaiModelName,
} from '@/lib/config';
import { searchHandlers } from '@/lib/search';

export const maxDuration = 300;

interface ResearchRequestBody {
  query: string;
  mode?: 'light' | 'max';
  optimizationMode?: 'speed' | 'balanced' | 'quality';
  stream?: boolean;
}

export const POST = async (req: Request) => {
  try {
    // Extract Bearer token (Chutes API key) from Authorization header
    const authHeader = req.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return Response.json(
        { error: 'Missing or invalid Authorization header. Use: Authorization: Bearer <chutes-api-key>' },
        { status: 401 },
      );
    }
    const apiKey = authHeader.slice(7).trim();
    if (!apiKey) {
      return Response.json({ error: 'Empty Bearer token' }, { status: 401 });
    }

    const body: ResearchRequestBody = await req.json();
    if (!body.query) {
      return Response.json({ error: 'Missing query' }, { status: 400 });
    }

    const mode = body.mode || 'light';
    const optimizationMode = body.optimizationMode || 'balanced';
    const stream = body.stream ?? true;

    // Build LLM candidates using the caller's API key
    const baseURL = getCustomOpenaiApiUrl();
    const optimizationModels: Record<string, string> = {
      speed: 'Qwen/Qwen3-Next-80B-A3B-Instruct',
      balanced: 'moonshotai/Kimi-K2.5-TEE',
      quality: 'moonshotai/Kimi-K2.5-TEE',
    };
    const primaryModel = optimizationModels[optimizationMode] || getCustomOpenaiModelName();
    const fallbackModels = [
      'deepseek-ai/DeepSeek-V3',
      'Qwen/Qwen2.5-72B-Instruct',
      'NousResearch/Hermes-4-70B',
    ];
    const chutesCandidates = buildChutesCandidates({
      modelNames: [primaryModel, ...fallbackModels],
      apiKey,
      baseURL,
    });

    const llmCandidates = chutesCandidates;
    const llm = llmCandidates[0]?.model as BaseChatModel;

    // Get embedding model (uses server-side config, not caller's key)
    const embeddingModelProviders = await getAvailableEmbeddingModelProviders();
    const embeddingProvider = Object.keys(embeddingModelProviders)[0];
    const embeddingModelName = Object.keys(embeddingModelProviders[embeddingProvider] || {})[0];
    const embeddings = embeddingModelProviders[embeddingProvider]?.[embeddingModelName]
      ?.model as Embeddings | undefined;

    if (!llm || !embeddings) {
      return Response.json({ error: 'Failed to initialize models' }, { status: 500 });
    }

    const searchHandler = searchHandlers['deepResearch'];
    const emitter = await searchHandler.searchAndAnswer(
      body.query,
      [],
      llm,
      embeddings,
      optimizationMode,
      [],
      '',
      mode,
      llmCandidates,
      { userAccessToken: apiKey },
    );

    if (!stream) {
      return new Promise<Response>((resolve) => {
        let message = '';
        let sources: any[] = [];
        let resolved = false;

        const safeResolve = (response: Response) => {
          if (resolved) return;
          resolved = true;
          resolve(response);
        };

        emitter.on('data', (data: string) => {
          try {
            const parsed = JSON.parse(data);
            if (parsed.type === 'response') message += parsed.data;
            else if (parsed.type === 'sources') sources = parsed.data;
          } catch {}
        });

        emitter.on('end', () => {
          safeResolve(Response.json({ message, sources }, { status: 200 }));
        });

        emitter.on('error', (error: any) => {
          const details =
            typeof error === 'string'
              ? error
              : error?.message
                ? String(error.message)
                : 'Research failed';
          const fallbackMessage =
            message.trim().length > 0
              ? message
              : 'I encountered an internal issue while finishing deep research. Here is a partial result based on sources collected so far.';
          safeResolve(
            Response.json(
              {
                message: fallbackMessage,
                sources,
                partial: true,
                error: details,
              },
              { status: 200 },
            ),
          );
        });
      });
    }

    // Streaming response (NDJSON)
    const encoder = new TextEncoder();
    const abortController = new AbortController();
    const { signal } = abortController;

    const readableStream = new ReadableStream({
      start(controller) {
        controller.enqueue(
          encoder.encode(JSON.stringify({ type: 'init', data: 'Stream connected' }) + '\n'),
        );

        // Heartbeat to prevent Vercel streaming idle timeout (~25s)
        const heartbeat = setInterval(() => {
          if (signal.aborted) return;
          try {
            controller.enqueue(encoder.encode(JSON.stringify({ type: 'keepAlive' }) + '\n'));
          } catch {}
        }, 15000);

        signal.addEventListener('abort', () => {
          clearInterval(heartbeat);
          emitter.removeAllListeners();
          try { controller.close(); } catch {}
        });

        emitter.on('data', (data: string) => {
          if (signal.aborted) return;
          try {
            const parsed = JSON.parse(data);
            controller.enqueue(encoder.encode(JSON.stringify(parsed) + '\n'));
          } catch (error) {
            controller.error(error);
          }
        });

        emitter.on('end', () => {
          clearInterval(heartbeat);
          if (signal.aborted) return;
          controller.enqueue(encoder.encode(JSON.stringify({ type: 'done' }) + '\n'));
          controller.close();
        });

        emitter.on('error', (error: any) => {
          clearInterval(heartbeat);
          if (signal.aborted) return;
          controller.error(error);
        });
      },
      cancel() {
        abortController.abort();
      },
    });

    return new Response(readableStream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
      },
    });
  } catch (err: any) {
    console.error(`[research-api] Error: ${err.message}`);
    return Response.json({ error: 'An error has occurred' }, { status: 500 });
  }
};
