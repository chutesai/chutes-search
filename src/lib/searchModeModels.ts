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

export const SPEED_MODELS = [
  'Qwen/Qwen3-Next-80B-A3B-Instruct',
  'unsloth/gemma-3-27b-it',
  'unsloth/Mistral-Nemo-Instruct-2407',
  'XiaomiMiMo/MiMo-V2-Flash-TEE',
  'openai/gpt-oss-120b-TEE',
  'chutesai/Mistral-Small-3.2-24B-Instruct-2506',
  'openai/gpt-oss-20b',
  'NousResearch/Hermes-4-14B',
] as const;

export const QUALITY_MODELS = [
  'moonshotai/Kimi-K2.5-TEE',
  'deepseek-ai/DeepSeek-V3.2-TEE',
  'zai-org/GLM-5-TEE',
  'MiniMaxAI/MiniMax-M2.5-TEE',
  'Qwen/Qwen3-VL-235B-A22B-Instruct',
] as const;

export const DEFAULT_SPEED_MODEL = SPEED_MODELS[0];
export const DEFAULT_QUALITY_MODEL = QUALITY_MODELS[0];

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
