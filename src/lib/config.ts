import toml from '@iarna/toml';

// Use dynamic imports for Node.js modules to prevent client-side errors
let fs: any;
let path: any;
if (typeof window === 'undefined') {
  // We're on the server
  fs = require('fs');
  path = require('path');
}

const configFileName = 'config.toml';

interface Config {
  GENERAL: {
    SIMILARITY_MEASURE: string;
    KEEP_ALIVE: string;
  };
  MODELS: {
    OPENAI: {
      API_KEY: string;
    };
    GROQ: {
      API_KEY: string;
    };
    ANTHROPIC: {
      API_KEY: string;
    };
    GEMINI: {
      API_KEY: string;
    };
    OLLAMA: {
      API_URL: string;
      API_KEY: string;
    };
    DEEPSEEK: {
      API_KEY: string;
    };
    AIMLAPI: {
      API_KEY: string;
    };
    LM_STUDIO: {
      API_URL: string;
    };
    CUSTOM_OPENAI: {
      API_URL: string;
      API_KEY: string;
      MODEL_NAME: string;
    };
  };
  API_ENDPOINTS: {
    SEARXNG: string;
  };
}

type RecursivePartial<T> = {
  [P in keyof T]?: RecursivePartial<T[P]>;
};

const defaultConfig: Config = {
  GENERAL: {
    SIMILARITY_MEASURE: 'cosine',
    KEEP_ALIVE: '5m',
  },
  MODELS: {
    OPENAI: { API_KEY: '' },
    GROQ: { API_KEY: '' },
    ANTHROPIC: { API_KEY: '' },
    GEMINI: { API_KEY: '' },
    OLLAMA: { API_URL: '', API_KEY: '' },
    DEEPSEEK: { API_KEY: '' },
    AIMLAPI: { API_KEY: '' },
    LM_STUDIO: { API_URL: '' },
    CUSTOM_OPENAI: { API_URL: '', API_KEY: '', MODEL_NAME: '' },
  },
  API_ENDPOINTS: {
    SEARXNG: '',
  },
};

const loadConfig = () => {
  // Server-side only
  if (typeof window === 'undefined') {
    try {
      const filePath = path.join(process.cwd(), `${configFileName}`);
      if (fs && fs.existsSync && fs.existsSync(filePath)) {
        return toml.parse(fs.readFileSync(filePath, 'utf-8')) as any as Config;
      }
    } catch (e) {
      // Fallback to defaults if parsing/reading fails
    }
    return defaultConfig as any as Config;
  }

  // Client-side fallback - settings will be loaded via API
  return defaultConfig as any as Config;
};

export const getSimilarityMeasure = () =>
  loadConfig().GENERAL.SIMILARITY_MEASURE;

export const getKeepAlive = () => loadConfig().GENERAL.KEEP_ALIVE;

export const getOpenaiApiKey = () =>
  process.env.OPENAI_API_KEY || loadConfig().MODELS.OPENAI.API_KEY;

export const getGroqApiKey = () =>
  process.env.GROQ_API_KEY || loadConfig().MODELS.GROQ.API_KEY;

export const getAnthropicApiKey = () =>
  process.env.ANTHROPIC_API_KEY || loadConfig().MODELS.ANTHROPIC.API_KEY;

export const getGeminiApiKey = () =>
  process.env.GEMINI_API_KEY || loadConfig().MODELS.GEMINI.API_KEY;

export const getSearxngApiEndpoint = () =>
  (() => {
    const urlsFromEnv = (process.env.SEARXNG_API_URLS || '')
      .split(',')
      .map((u) => u.trim())
      .filter((u) => /^https?:\/\//.test(u));
    const single = process.env.SEARXNG_API_URL || loadConfig().API_ENDPOINTS.SEARXNG || '';
    const all = [...urlsFromEnv, ...(single ? [single] : [])];
    if (all.length === 0) return '';
    const idx = Math.floor(Math.random() * all.length);
    return all[idx];
  })();

export const getSearxngApiEndpoints = () => {
  const urlsFromEnv = (process.env.SEARXNG_API_URLS || '')
    .split(',')
    .map((u) => u.trim())
    .filter((u) => /^https?:\/\//.test(u));
  const single = process.env.SEARXNG_API_URL || loadConfig().API_ENDPOINTS.SEARXNG || '';
  const all = [...urlsFromEnv, ...(single ? [single] : [])];
  return all;
};

export const getOllamaApiEndpoint = () =>
  process.env.OLLAMA_API_URL || loadConfig().MODELS.OLLAMA.API_URL;

export const getOllamaApiKey = () =>
  process.env.OLLAMA_API_KEY || loadConfig().MODELS.OLLAMA.API_KEY;

export const getDeepseekApiKey = () =>
  process.env.DEEPSEEK_API_KEY || loadConfig().MODELS.DEEPSEEK.API_KEY;

export const getAimlApiKey = () =>
  process.env.AIMLAPI_API_KEY || loadConfig().MODELS.AIMLAPI.API_KEY;

export const getCustomOpenaiApiKey = () =>
  (process.env.CHUTES_API_KEY || loadConfig().MODELS.CUSTOM_OPENAI.API_KEY);

export const getCustomOpenaiApiUrl = () =>
  (process.env.CHUTES_API_URL || loadConfig().MODELS.CUSTOM_OPENAI.API_URL || 'https://llm.chutes.ai/v1');

export const getCustomOpenaiModelName = () =>
  (process.env.CHUTES_MODEL_NAME || loadConfig().MODELS.CUSTOM_OPENAI.MODEL_NAME || 'deepseek-ai/DeepSeek-V3.1');

export const getLMStudioApiEndpoint = () =>
  process.env.LM_STUDIO_API_URL || loadConfig().MODELS.LM_STUDIO.API_URL;

const mergeConfigs = (current: any, update: any): any => {
  if (update === null || update === undefined) {
    return current;
  }

  if (typeof current !== 'object' || current === null) {
    return update;
  }

  const result = { ...current };

  for (const key in update) {
    if (Object.prototype.hasOwnProperty.call(update, key)) {
      const updateValue = update[key];

      if (
        typeof updateValue === 'object' &&
        updateValue !== null &&
        typeof result[key] === 'object' &&
        result[key] !== null
      ) {
        result[key] = mergeConfigs(result[key], updateValue);
      } else if (updateValue !== undefined) {
        result[key] = updateValue;
      }
    }
  }

  return result;
};

export const updateConfig = (config: RecursivePartial<Config>) => {
  // Server-side only
  if (typeof window === 'undefined') {
    const currentConfig = loadConfig();
    const mergedConfig = mergeConfigs(currentConfig, config);
    fs.writeFileSync(
      path.join(path.join(process.cwd(), `${configFileName}`)),
      toml.stringify(mergedConfig),
    );
  }
};
