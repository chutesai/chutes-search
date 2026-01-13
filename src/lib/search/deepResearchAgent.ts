import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { Embeddings } from '@langchain/core/embeddings';
import { BaseMessage } from '@langchain/core/messages';
import { ChatPromptTemplate, MessagesPlaceholder } from '@langchain/core/prompts';
import { RunnableMap, RunnableSequence } from '@langchain/core/runnables';
import { StringOutputParser } from '@langchain/core/output_parsers';
import eventEmitter from 'events';
import { Document } from '@langchain/core/documents';
import { deepResearchResponsePrompt } from '@/lib/prompts/deepResearch';
import {
  runDeepResearchCollector,
  DeepResearchProgress,
  DeepResearchMode,
} from './deepResearchCollector';
import { runWebSearch } from './runWebSearch';
import { isRateLimitError, LlmCandidate } from '@/lib/llm/fallbacks';

const createTimer = (prefix: string) => {
  const start = Date.now();
  return (step: string) => {
    console.log(`[${prefix}] ${new Date().toISOString()} | +${Date.now() - start}ms | ${step}`);
  };
};

const processDocs = (docs: Document[]) =>
  docs
    .map(
      (_, index) =>
        `${index + 1}. ${docs[index].metadata.title} ${docs[index].pageContent}`,
    )
    .join('\n');

const ensureProgressDefaults = (progress: DeepResearchProgress[]) => {
  const baseline = [
    { id: 'search', label: 'Finding sources' },
    { id: 'sandbox', label: 'Preparing sandbox' },
    { id: 'setup', label: 'Installing Playwright' },
    { id: 'browser', label: 'Launching browser' },
    { id: 'crawl', label: 'Crawling pages' },
    { id: 'analysis', label: 'Synthesizing notes' },
    { id: 'finalize', label: 'Drafting report' },
    { id: 'cleanup', label: 'Cleaning up sandbox' },
  ];

  const seen = new Set(progress.map((item) => item.id));
  return [
    ...progress,
    ...baseline
      .filter((item) => !seen.has(item.id))
      .map((item) => ({
        id: item.id,
        label: item.label,
        status: 'pending' as const,
      })),
  ];
};

class DeepResearchAgent {
  private strParser = new StringOutputParser();

  async searchAndAnswer(
    message: string,
    history: BaseMessage[],
    llm: BaseChatModel,
    _embeddings: Embeddings,
    optimizationMode: 'speed' | 'balanced' | 'quality',
    _fileIds: string[],
    systemInstructions: string,
    deepResearchMode: DeepResearchMode = 'light',
    llmCandidates?: LlmCandidate[],
  ) {
    const emitter = new eventEmitter();
    const timer = createTimer('deepResearch');

    const run = async () => {
      const emitProgress = (progress: DeepResearchProgress) => {
        emitter.emit('data', JSON.stringify({ type: 'progress', data: progress }));
      };

      ensureProgressDefaults([]).forEach((progress) => emitProgress(progress));

      try {
        timer('Starting deep research collection');
        const onProgress = (progress: DeepResearchProgress) => {
          emitProgress(progress);
        };

        let docs: Document[] = [];
        let sources: { title: string; url: string; content: string; description?: string }[] = [];

        try {
          const collected = await runDeepResearchCollector(
            message,
            optimizationMode,
            deepResearchMode,
            onProgress,
          );
          docs = collected.docs;
          sources = collected.sources;
        } catch (error: any) {
          emitProgress({
            id: 'sandbox',
            label: 'Preparing sandbox',
            status: 'error',
            detail: error?.message || 'Deep research failed. Falling back to standard search.',
          });
          const fallback = await runWebSearch(message, []);
          docs = (fallback.results || []).map(
            (result) =>
              new Document({
                pageContent: result.content || '',
                metadata: {
                  title: result.title || result.url,
                  url: result.url,
                },
              }),
          );
          sources = (fallback.results || []).map((result) => ({
            title: result.title || result.url,
            url: result.url,
            content: result.content || '',
          }));
        }

        const safeDocs = docs.length > 0
          ? docs
          : sources.map(
              (source) =>
                new Document({
                  pageContent: source.content || source.description || '',
                  metadata: {
                    title: source.title,
                    url: source.url,
                  },
                }),
            );
        const docLimitByMode = {
          light: { speed: 8, balanced: 10, quality: 12 },
          max: { speed: 12, balanced: 16, quality: 20 },
        } as const;
        const docLimit =
          docLimitByMode[deepResearchMode]?.[optimizationMode] ?? 10;
        const limitedDocs = safeDocs.slice(0, docLimit);

        emitter.emit(
          'data',
          JSON.stringify({ type: 'sources', data: limitedDocs }),
        );

        if (limitedDocs.length === 0) {
          emitProgress({
            id: 'finalize',
            label: 'Drafting report',
            status: 'error',
            detail: 'No sources were available for this query.',
          });
          emitter.emit(
            'data',
            JSON.stringify({
              type: 'response',
              data: 'Hmm, I could not reach any sources for this query. Try refining the topic or running Deep Research again.',
            }),
          );
          emitter.emit('end');
          return;
        }

        timer('Documents prepared, starting response generation');

        const context = processDocs(limitedDocs);
        emitProgress({
          id: 'finalize',
          label: 'Drafting report',
          status: 'running',
        });

        const summaryCandidates =
          llmCandidates && llmCandidates.length > 0
            ? llmCandidates
            : [{ name: 'primary', model: llm }];

        for (let i = 0; i < summaryCandidates.length; i += 1) {
          const candidate = summaryCandidates[i];
          const state = { hasOutput: false, completed: false };

          try {
            const chain = RunnableSequence.from([
              RunnableMap.from({
                systemInstructions: () => systemInstructions,
                query: (input: { query: string; chat_history: BaseMessage[] }) =>
                  input.query,
                chat_history: (input: { query: string; chat_history: BaseMessage[] }) =>
                  input.chat_history,
                date: () => new Date().toISOString(),
                context: () => context,
              }),
              ChatPromptTemplate.fromMessages([
                ['system', deepResearchResponsePrompt],
                new MessagesPlaceholder('chat_history'),
                ['user', '{query}'],
              ]),
              candidate.model,
              this.strParser,
            ]).withConfig({
              runName: 'DeepResearchResponseGenerator',
            });

            const stream = chain.streamEvents(
              {
                chat_history: history,
                query: message,
              },
              { version: 'v1' },
            );

            for await (const event of stream) {
              if (
                event.event === 'on_chain_stream' &&
                event.name === 'DeepResearchResponseGenerator'
              ) {
                emitter.emit(
                  'data',
                  JSON.stringify({ type: 'response', data: event.data.chunk }),
                );
                state.hasOutput = true;
              }
              if (
                event.event === 'on_chain_end' &&
                event.name === 'DeepResearchResponseGenerator'
              ) {
                state.completed = true;
                emitProgress({
                  id: 'finalize',
                  label: 'Drafting report',
                  status: 'complete',
                });
                break;
              }
            }

            emitter.emit('end');
            return;
          } catch (err: any) {
            const canRetry =
              isRateLimitError(err) &&
              !state.hasOutput &&
              i < summaryCandidates.length - 1;
            if (canRetry) {
              timer(
                `Rate limited on ${candidate.name}, retrying with ${summaryCandidates[i + 1].name}`,
              );
              emitProgress({
                id: 'finalize',
                label: 'Drafting report',
                status: 'running',
                detail: `Rate limited on ${candidate.name}. Retrying.`,
              });
              continue;
            }
            throw err;
          }
        }
      } catch (err: any) {
        timer(`Error: ${err?.message}`);
        emitter.emit(
          'error',
          JSON.stringify({
            type: 'error',
            data: err?.message || 'Deep research failed',
          }),
        );
        emitProgress({
          id: 'finalize',
          label: 'Drafting report',
          status: 'error',
          detail: err?.message || 'Deep research failed',
        });
        emitter.emit('end');
      }
    };

    setImmediate(() => void run());

    return emitter;
  }
}

export default DeepResearchAgent;
