import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { ChatOpenAI } from '@langchain/openai';

export type LlmCandidate = {
  name: string;
  model: BaseChatModel;
};

const uniqueNames = (names: string[]) => {
  const seen = new Set<string>();
  return names
    .map((name) => name.trim())
    .filter((name) => {
      if (!name || seen.has(name)) return false;
      seen.add(name);
      return true;
    });
};

const buildCandidate = ({
  name,
  modelName,
  apiKey,
  baseURL,
  temperature,
  maxRetries,
}: {
  name?: string;
  modelName: string;
  apiKey: string;
  baseURL: string;
  temperature: number;
  maxRetries: number;
}): LlmCandidate => ({
  name: name || modelName,
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
});

export const buildChutesCandidates = ({
  modelNames,
  apiKey,
  baseURL,
  modelRouterBaseURL,
  modelRouterModelName = 'model-router',
  temperature = 0.7,
  maxRetries = 1,
}: {
  modelNames: string[];
  apiKey: string;
  baseURL: string;
  modelRouterBaseURL?: string;
  modelRouterModelName?: string;
  temperature?: number;
  maxRetries?: number;
}): LlmCandidate[] => {
  const candidates = uniqueNames(modelNames).map((modelName) =>
    buildCandidate({
      modelName,
      apiKey,
      baseURL,
      temperature,
      maxRetries,
    }),
  );

  if (modelRouterBaseURL?.trim()) {
    candidates.push(
      buildCandidate({
        name: `${modelRouterModelName} (Model Router)`,
        modelName: modelRouterModelName,
        apiKey,
        baseURL: modelRouterBaseURL.trim(),
        temperature,
        maxRetries,
      }),
    );
  }

  return candidates;
};

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

export const isModelUnavailableError = (err: unknown) => {
  const status = getErrorStatus(err as any);
  if (status === 404) return true;

  const message =
    typeof err === 'string'
      ? err.toLowerCase()
      : (err as any)?.message?.toLowerCase?.() ?? '';

  return (
    message.includes('model_not_found') ||
    message.includes('model not found') ||
    message.includes('404 status code')
  );
};

export const isModelCapacityError = (err: unknown) => {
  const status = getErrorStatus(err as any);
  if (typeof status === 'number' && status !== 400) return false;

  const message =
    typeof err === 'string'
      ? err.toLowerCase()
      : (err as any)?.message?.toLowerCase?.() ?? '';

  return (
    message.includes('maximum context length') ||
    message.includes('max context length') ||
    message.includes('requested token count exceeds') ||
    message.includes('max tokens') ||
    message.includes('max_tokens')
  );
};

export const isFallbackableUpstreamError = (err: unknown) =>
  isRateLimitError(err) ||
  isRetryableUpstreamError(err) ||
  isModelUnavailableError(err) ||
  isModelCapacityError(err);

export const runWithLlmCandidates = async <T>(
  candidates: LlmCandidate[],
  run: (candidate: LlmCandidate) => Promise<T>,
  onFallback?: (
    err: unknown,
    candidate: LlmCandidate,
    nextCandidate: LlmCandidate,
  ) => void,
) => {
  let lastError: unknown;

  for (let i = 0; i < candidates.length; i += 1) {
    const candidate = candidates[i];
    try {
      return await run(candidate);
    } catch (err) {
      lastError = err;
      const nextCandidate = candidates[i + 1];
      if (nextCandidate && isFallbackableUpstreamError(err)) {
        onFallback?.(err, candidate, nextCandidate);
        continue;
      }
      throw err;
    }
  }

  throw lastError;
};
