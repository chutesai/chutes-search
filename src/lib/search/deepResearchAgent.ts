import crypto from 'crypto';
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
import { isRateLimitError, isRetryableUpstreamError, LlmCandidate } from '@/lib/llm/fallbacks';
import { anonymizeLogText, logEvent, serializeError } from '@/lib/eventLog';
import type { SearchRequestContext } from '@/lib/search/metaSearchAgent';

const createTimer = (prefix: string) => {
  const start = Date.now();
  return (step: string) => {
    console.log(`[${prefix}] ${new Date().toISOString()} | +${Date.now() - start}ms | ${step}`);
  };
};

const truncateContextText = (value: string, maxChars: number) => {
  if (!value) return '';
  if (value.length <= maxChars) return value;
  return `${value.slice(0, maxChars)}...`;
};

const tokenizeForMatch = (value: string) =>
  value
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3);

const evidenceSentencePattern =
  /\b(data|evidence|study|research|report|survey|analysis|method|result|trend|risk|impact)\b/i;
const lowValueSentencePattern =
  /\b(cookie|privacy|sign in|login|sign up|register|subscribe|newsletter)\b/i;

const buildFocusedExcerpt = (text: string, query: string, maxChars: number) => {
  const normalized = (text || '').replace(/\r/g, ' ').replace(/\n+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!normalized) return '';

  const queryFacets = tokenizeForMatch(query).slice(0, 14);
  if (queryFacets.length === 0) {
    return truncateContextText(normalized, maxChars);
  }

  const rawUnits = normalized.match(/[^.!?]+[.!?]?/g) || [normalized];
  const units = rawUnits
    .map((unit) => unit.trim())
    .filter((unit) => unit.length >= 24);

  const scored = units
    .map((unit, index) => {
      const tokens = tokenizeForMatch(unit);
      const tokenSet = new Set(tokens);
      const facetHits = queryFacets.filter((facet) => tokenSet.has(facet)).length;
      let score = facetHits * 2.4;
      score += Math.min(1.2, tokenSet.size / 28);
      if (evidenceSentencePattern.test(unit)) score += 0.8;
      if (/\d/.test(unit)) score += 0.5;
      if (unit.length < 55) score -= 0.6;
      if (lowValueSentencePattern.test(unit)) score -= 1.2;
      return { unit, index, score, tokens };
    })
    .sort((a, b) => b.score - a.score);

  const selected: Array<{ unit: string; index: number; score: number; tokens: string[] }> = [];
  const selectedTokenSet = new Set<string>();
  for (const candidate of scored) {
    if (selected.length >= 12) break;
    const novelTokens = candidate.tokens.filter((token) => !selectedTokenSet.has(token)).length;
    if (selected.length > 0 && novelTokens < 2 && candidate.score < 2.2) {
      continue;
    }
    selected.push(candidate);
    candidate.tokens.forEach((token) => selectedTokenSet.add(token));
  }

  const ordered = (selected.length > 0 ? selected : scored.slice(0, 4))
    .sort((a, b) => a.index - b.index)
    .map((item) => item.unit);

  const chunks: string[] = [];
  let totalLength = 0;
  for (const chunk of ordered) {
    if (totalLength >= maxChars) break;
    const next = chunks.length === 0 ? chunk : ` ${chunk}`;
    if (totalLength + next.length > maxChars) {
      const remaining = Math.max(0, maxChars - totalLength);
      if (remaining > 120) {
        chunks.push(`${next.slice(0, remaining)}...`);
      }
      break;
    }
    chunks.push(next);
    totalLength += next.length;
  }

  const excerpt = chunks.join('').trim();
  if (!excerpt) {
    return truncateContextText(normalized, maxChars);
  }
  return excerpt;
};

const processDocs = (docs: Document[], query: string, maxCharsPerDoc: number) =>
  docs
    .map((doc, index) => {
      const title = String(doc.metadata.title || 'Untitled source');
      const url = String(doc.metadata.url || '');
      const body = buildFocusedExcerpt(doc.pageContent || '', query, maxCharsPerDoc);
      return `${index + 1}. ${title}\nURL: ${url}\n${body}`;
    })
    .join('\n\n');

const ensureProgressDefaults = (progress: DeepResearchProgress[]) => {
  const baseline = [
    { id: 'search', label: 'Finding sources' },
    { id: 'sandbox', label: 'Preparing sandbox' },
    { id: 'setup', label: 'Installing Browser' },
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
    requestContext?: SearchRequestContext,
  ) {
    const emitter = new eventEmitter();
    const timer = createTimer('deepResearch');
    const runId = crypto.randomBytes(16).toString('hex');

    const run = async () => {
      const emitProgress = (progress: DeepResearchProgress) => {
        emitter.emit('data', JSON.stringify({ type: 'progress', data: progress }));
      };

      logEvent({
        level: 'info',
        event: 'deep_research.start',
        correlationId: runId,
        metadata: { mode: deepResearchMode, optimizationMode },
      });

      const logProgressEvent = (progress: DeepResearchProgress) => {
        // Keep logs useful but low-volume. Record completion and errors, not every tick.
        if (progress.status === 'running' || progress.status === 'pending') return;
        logEvent({
          level: progress.status === 'error' ? 'error' : 'info',
          event: `deep_research.progress.${progress.id}`,
          correlationId: runId,
          metadata: {
            status: progress.status,
            percent: progress.percent,
            detail: progress.detail ? anonymizeLogText(progress.detail) : undefined,
          },
        });
      };

      ensureProgressDefaults([]).forEach((progress) => emitProgress(progress));

      try {
        timer('Starting deep research collection');
        const onProgress = (progress: DeepResearchProgress) => {
          emitProgress(progress);
          logProgressEvent(progress);
        };

        let docs: Document[] = [];
        let sources: { title: string; url: string; content: string; description?: string }[] = [];

        try {
          const collected = await runDeepResearchCollector(
            message,
            optimizationMode,
            deepResearchMode,
            onProgress,
            {
              correlationId: runId,
              agentApiKey: requestContext?.userAccessToken,
            },
          );
          docs = collected.docs;
          sources = collected.sources;
        } catch (error: any) {
          logEvent({
            level: 'error',
            event: 'deep_research.collector_error',
            correlationId: runId,
            metadata: { error: serializeError(error) },
          });
          const rawMessage = error?.message ? String(error.message) : '';
          const userFacingDetail = rawMessage.includes('Sandy API error')
            ? 'Sandbox service error. Falling back to standard search.'
            : rawMessage ||
              'Deep research failed. Falling back to standard search.';
          emitProgress({
            id: 'sandbox',
            label: 'Preparing sandbox',
            status: 'error',
            detail: userFacingDetail,
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
          max: { speed: 13, balanced: 16, quality: 18 },
        } as const;
        const contextCharsByMode = {
          light: { speed: 1200, balanced: 1700, quality: 2100 },
          max: { speed: 2200, balanced: 3000, quality: 3800 },
        } as const;
        const docLimit =
          docLimitByMode[deepResearchMode]?.[optimizationMode] ?? 10;
        const limitedDocs = safeDocs.slice(0, docLimit);
        const maxCharsPerDoc =
          contextCharsByMode[deepResearchMode]?.[optimizationMode] ?? 1800;

        logEvent({
          level: 'info',
          event: 'deep_research.sources_ready',
          correlationId: runId,
          metadata: { docs: limitedDocs.length, mode: deepResearchMode },
        });

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
          logEvent({
            level: 'warn',
            event: 'deep_research.no_sources',
            correlationId: runId,
          });
          return;
        }

        timer('Documents prepared, starting response generation');

        const context = processDocs(limitedDocs, message, maxCharsPerDoc);
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
            logEvent({
              level: 'info',
              event: 'deep_research.complete',
              correlationId: runId,
            });
            return;
          } catch (err: any) {
            const canRetry =
              (isRateLimitError(err) || isRetryableUpstreamError(err)) &&
              !state.hasOutput &&
              i < summaryCandidates.length - 1;
            if (canRetry) {
              timer(
                `Retryable upstream error on ${candidate.name}, retrying with ${summaryCandidates[i + 1].name}`,
              );
              emitProgress({
                id: 'finalize',
                label: 'Drafting report',
                status: 'running',
                detail: `Temporary upstream issue on ${candidate.name}. Retrying.`,
              });
              logEvent({
                level: 'warn',
                event: 'deep_research.retryable_retry',
                correlationId: runId,
                metadata: { candidate: candidate.name, next: summaryCandidates[i + 1]?.name },
              });
              continue;
            }
            throw err;
          }
        }
      } catch (err: any) {
        timer(`Error: ${err?.message}`);
        logEvent({
          level: 'error',
          event: 'deep_research.error',
          correlationId: runId,
          metadata: { error: serializeError(err) },
        });
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
