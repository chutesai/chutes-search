import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { ChatOpenAI } from '@langchain/openai';

export type LlmCandidate = {
  name: string;
  model: BaseChatModel;
};

const uniqueNames = (names: string[]) => {
  const seen = new Set<string>();
  return names.filter((name) => {
    const trimmed = name.trim();
    if (!trimmed || seen.has(trimmed)) return false;
    seen.add(trimmed);
    return true;
  });
};

export const buildChutesCandidates = ({
  modelNames,
  apiKey,
  baseURL,
  temperature = 0.7,
  maxRetries = 1,
}: {
  modelNames: string[];
  apiKey: string;
  baseURL: string;
  temperature?: number;
  maxRetries?: number;
}): LlmCandidate[] =>
  uniqueNames(modelNames).map((modelName) => ({
    name: modelName,
    model: new ChatOpenAI({
      apiKey,
      modelName,
      temperature,
      maxRetries,
      configuration: {
        baseURL,
        defaultHeaders: {
          'X-Identifier': 'chutes-search',
        },
      },
    }) as unknown as BaseChatModel,
  }));

const getErrorStatus = (err: any) =>
  err?.status ??
  err?.statusCode ??
  err?.response?.status ??
  err?.cause?.status ??
  err?.error?.status;

export const isRateLimitError = (err: unknown) => {
  const status = getErrorStatus(err as any);
  if (status === 429) return true;

  const message =
    typeof err === 'string'
      ? err.toLowerCase()
      : (err as any)?.message?.toLowerCase?.() ?? '';

  return (
    message.includes('rate limit') ||
    message.includes('too many requests') ||
    message.includes('429')
  );
};

export const isRetryableUpstreamError = (err: unknown) => {
  const status = getErrorStatus(err as any);
  if (typeof status === 'number') {
    if ([408, 500, 502, 503, 504, 522, 524].includes(status)) return true;
  }

  const message =
    typeof err === 'string'
      ? err.toLowerCase()
      : (err as any)?.message?.toLowerCase?.() ?? '';

  // Common transient transport / gateway issues (including the "503 status code (no body)" we see
  // when the OpenAI-compatible upstream is unhealthy).
  return (
    message.includes('503 status code') ||
    message.includes('502 status code') ||
    message.includes('504 status code') ||
    message.includes('service unavailable') ||
    message.includes('bad gateway') ||
    message.includes('gateway timeout') ||
    message.includes('timeout') ||
    message.includes('socket hang up') ||
    message.includes('econnreset') ||
    message.includes('etimedout') ||
    message.includes('eai_again') ||
    message.includes('fetch failed')
  );
};
