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
