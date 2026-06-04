export type SearchOptimizationMode = 'speed' | 'balanced' | 'quality';
export type SearchModePreferenceKey = 'speed' | 'quality';

export type SearchModeModelPreferences = {
  speed?: string | null;
  quality?: string | null;
};

export type SearchModeModelPreferenceValues = {
  speed: string;
  quality: string;
};

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

// Synced with https://llm.chutes.ai/v1/models on 2026-05-19.
// Keep these lists intentionally small: they drive user-visible mode defaults
// and server fallback chains, so deleted model IDs cause production 404s.
// Live Chutes catalog (GET https://llm.chutes.ai/v1/models) — snapshot verified
// 2026-06-04. Every model configured below MUST be in this set (pinned by test).
// Removed (no longer live): zai-org/GLM-5-Turbo, Qwen/Qwen2.5-Coder-32B-Instruct-TEE,
// Qwen/Qwen3-235B-A22B-Thinking-2507 (the live id is the -TEE variant).
export const LIVE_CHUTES_MODEL_IDS = [
  'MiniMaxAI/MiniMax-M2.5-TEE',
  'Qwen/Qwen3-235B-A22B-Thinking-2507-TEE',
  'Qwen/Qwen3-32B-TEE',
  'Qwen/Qwen3.5-397B-A17B-TEE',
  'Qwen/Qwen3.6-27B-TEE',
  'deepseek-ai/DeepSeek-V3.2-TEE',
  'google/gemma-4-31B-turbo-TEE',
  'moonshotai/Kimi-K2.5-TEE',
  'moonshotai/Kimi-K2.6-TEE',
  'unsloth/Mistral-Nemo-Instruct-2407-TEE',
  'zai-org/GLM-5-TEE',
  'zai-org/GLM-5.1-TEE',
] as const;

// Speed mode MUST use non-reasoning models: a single search does a query-rephrase
// call + an answer call, and reasoning models (Kimi, GLM, Qwen-Thinking) burn
// hundreds of tokens "thinking" before emitting any content — measured TTFC was
// 1.4–1.8s for gemma/deepseek vs. zero content within 80 tokens for the reasoners,
// which made Kimi-K2.6 speed mode take minutes. Order = fastest-good first, then
// progressively heavier non-reasoning fallbacks (multiple, in case one is
// deregistered from Chutes). gemma-4-31B-turbo gives a clean rephrase + answer in
// ~1.8s and is also the model-router's classifier (fast) model.
export const SPEED_MODELS = [
  'google/gemma-4-31B-turbo-TEE',
  'deepseek-ai/DeepSeek-V3.2-TEE',
  'Qwen/Qwen3-32B-TEE',
  'unsloth/Mistral-Nemo-Instruct-2407-TEE',
] as const;

// Quality mode: latency is acceptable, so the strongest models (incl. reasoners)
// lead, with several fallbacks for resilience to deregistration.
export const QUALITY_MODELS = [
  'deepseek-ai/DeepSeek-V3.2-TEE',
  'moonshotai/Kimi-K2.6-TEE',
  'zai-org/GLM-5.1-TEE',
  'Qwen/Qwen3.5-397B-A17B-TEE',
  'MiniMaxAI/MiniMax-M2.5-TEE',
  'Qwen/Qwen3-235B-A22B-Thinking-2507-TEE',
  'moonshotai/Kimi-K2.5-TEE',
  'zai-org/GLM-5-TEE',
] as const;

export const DEFAULT_SPEED_MODEL = SPEED_MODELS[0];
export const DEFAULT_QUALITY_MODEL = QUALITY_MODELS[0];
export const DEFAULT_CHUTES_MODEL = DEFAULT_QUALITY_MODEL;

export const SEARCH_FALLBACK_MODELS = [
  'google/gemma-4-31B-turbo-TEE',
  'zai-org/GLM-5.1-TEE',
  'deepseek-ai/DeepSeek-V3.2-TEE',
  'MiniMaxAI/MiniMax-M2.5-TEE',
  'Qwen/Qwen3.5-397B-A17B-TEE',
  'moonshotai/Kimi-K2.5-TEE',
] as const;

export const DEEP_RESEARCH_SUMMARY_MODELS = [
  'deepseek-ai/DeepSeek-V3.2-TEE',
  'zai-org/GLM-5.1-TEE',
  'moonshotai/Kimi-K2.6-TEE',
  'Qwen/Qwen3-235B-A22B-Thinking-2507-TEE',
] as const;

export const AUXILIARY_LLM_MODELS = [
  'google/gemma-4-31B-turbo-TEE',
  'unsloth/Mistral-Nemo-Instruct-2407-TEE',
  'zai-org/GLM-5.1-TEE',
  'deepseek-ai/DeepSeek-V3.2-TEE',
] as const;

export const SEARCH_MODE_MODEL_STORAGE_KEYS = {
  speed: 'searchMode.speedModel',
  quality: 'searchMode.qualityModel',
} as const;

const SPEED_MODEL_SET = new Set<string>(SPEED_MODELS);
const QUALITY_MODEL_SET = new Set<string>(QUALITY_MODELS);

export function sanitizeSearchModeModel(
  key: SearchModePreferenceKey,
  value: string | null | undefined,
): string {
  if (key === 'speed') {
    return value && SPEED_MODEL_SET.has(value) ? value : DEFAULT_SPEED_MODEL;
  }

  return value && QUALITY_MODEL_SET.has(value) ? value : DEFAULT_QUALITY_MODEL;
}

export function readSearchModeModelPreferences(
  storage: StorageLike,
): SearchModeModelPreferenceValues {
  return {
    speed: sanitizeSearchModeModel(
      'speed',
      storage.getItem(SEARCH_MODE_MODEL_STORAGE_KEYS.speed),
    ),
    quality: sanitizeSearchModeModel(
      'quality',
      storage.getItem(SEARCH_MODE_MODEL_STORAGE_KEYS.quality),
    ),
  };
}

export function persistSearchModeModelPreference(
  storage: StorageLike,
  key: SearchModePreferenceKey,
  value: string,
): string {
  const sanitized = sanitizeSearchModeModel(key, value);
  storage.setItem(SEARCH_MODE_MODEL_STORAGE_KEYS[key], sanitized);
  return sanitized;
}

export function resolveOptimizationModeModelName(
  optimizationMode: SearchOptimizationMode,
  preferences?: SearchModeModelPreferences,
): string {
  if (optimizationMode === 'speed') {
    return sanitizeSearchModeModel('speed', preferences?.speed);
  }

  return sanitizeSearchModeModel('quality', preferences?.quality);
}

export function resolveOptimizationModeMaxTokens(
  optimizationMode: SearchOptimizationMode,
  options?: {
    focusMode?: string;
    deepResearchMode?: 'light' | 'max';
  },
): number {
  if (options?.focusMode === 'deepResearch') {
    return options.deepResearchMode === 'max' ? 3200 : 2200;
  }

  // Chutes TEE throughput is ~6 tokens/s, so answer length dominates wall-clock.
  // Speed mode keeps answers concise to stay responsive; balanced/quality trade
  // latency for depth.
  if (optimizationMode === 'speed') return 500;
  if (optimizationMode === 'balanced') return 1200;
  return 1600;
}
