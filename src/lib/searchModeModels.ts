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
export const LIVE_CHUTES_MODEL_IDS = [
  'Qwen/Qwen3-32B-TEE',
  'google/gemma-4-31B-turbo-TEE',
  'zai-org/GLM-5.1-TEE',
  'moonshotai/Kimi-K2.5-TEE',
  'Qwen/Qwen3.5-397B-A17B-TEE',
  'zai-org/GLM-5-Turbo',
  'deepseek-ai/DeepSeek-V3.2-TEE',
  'moonshotai/Kimi-K2.6-TEE',
  'MiniMaxAI/MiniMax-M2.5-TEE',
  'zai-org/GLM-5-TEE',
  'Qwen/Qwen3.6-27B-TEE',
  'Qwen/Qwen2.5-Coder-32B-Instruct-TEE',
  'unsloth/Mistral-Nemo-Instruct-2407-TEE',
  'Qwen/Qwen3-235B-A22B-Thinking-2507',
] as const;

export const SPEED_MODELS = [
  // Kimi K2.6 is the default speed model: the small models (Mistral-Nemo etc.)
  // produced weak query rephrasings, which made the web-search engine return
  // unrelated results (e.g. random YouTube videos matching a single stop-word).
  // Speed mode skips embedding reranking, so source quality depends entirely on
  // the rephrased query — hence a stronger model here.
  'moonshotai/Kimi-K2.6-TEE',
  'google/gemma-4-31B-turbo-TEE',
  'Qwen/Qwen3-32B-TEE',
  'Qwen/Qwen3.6-27B-TEE',
  'unsloth/Mistral-Nemo-Instruct-2407-TEE',
] as const;

export const QUALITY_MODELS = [
  'deepseek-ai/DeepSeek-V3.2-TEE',
  'Qwen/Qwen3.5-397B-A17B-TEE',
  'zai-org/GLM-5.1-TEE',
  'moonshotai/Kimi-K2.6-TEE',
  'MiniMaxAI/MiniMax-M2.5-TEE',
  'Qwen/Qwen3-235B-A22B-Thinking-2507',
  'moonshotai/Kimi-K2.5-TEE',
  'zai-org/GLM-5-TEE',
  'zai-org/GLM-5-Turbo',
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
  'Qwen/Qwen3-235B-A22B-Thinking-2507',
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

  if (optimizationMode === 'speed') return 800;
  if (optimizationMode === 'balanced') return 1200;
  return 1600;
}
