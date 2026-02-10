import {
  getAnthropicApiKey,
  getCustomOpenaiApiKey,
  getCustomOpenaiApiUrl,
  getCustomOpenaiModelName,
  getGeminiApiKey,
  getGroqApiKey,
  getOllamaApiEndpoint,
  getOpenaiApiKey,
  getDeepseekApiKey,
  getAimlApiKey,
  getLMStudioApiEndpoint,
  updateConfig,
  getOllamaApiKey,
} from '@/lib/config';
import {
  getAvailableChatModelProviders,
  getAvailableEmbeddingModelProviders,
} from '@/lib/providers';

const allowConfigWrite =
  process.env.NODE_ENV !== 'production' ||
  process.env.CHUTES_SEARCH_ALLOW_CONFIG_WRITE === 'true';

export const GET = async (req: Request) => {
  try {
    const config: Record<string, any> = {};

    const [chatModelProviders, embeddingModelProviders] = await Promise.all([
      getAvailableChatModelProviders(),
      getAvailableEmbeddingModelProviders(),
    ]);

    config['chatModelProviders'] = {};
    config['embeddingModelProviders'] = {};

    for (const provider in chatModelProviders) {
      config['chatModelProviders'][provider] = Object.keys(
        chatModelProviders[provider],
      ).map((model) => {
        return {
          name: model,
          displayName: chatModelProviders[provider][model].displayName,
        };
      });
    }

    for (const provider in embeddingModelProviders) {
      config['embeddingModelProviders'][provider] = Object.keys(
        embeddingModelProviders[provider],
      ).map((model) => {
        return {
          name: model,
          displayName: embeddingModelProviders[provider][model].displayName,
        };
      });
    }

    // Never return secret values to the client.
    // The settings page can still show "configured" status via the booleans below.
    config['openaiApiKey'] = '';
    config['anthropicApiKey'] = '';
    config['groqApiKey'] = '';
    config['geminiApiKey'] = '';
    config['deepseekApiKey'] = '';
    config['aimlApiKey'] = '';
    config['ollamaApiKey'] = '';
    config['customOpenaiApiKey'] = '';

    config['openaiApiKeyPresent'] = Boolean(getOpenaiApiKey());
    config['anthropicApiKeyPresent'] = Boolean(getAnthropicApiKey());
    config['groqApiKeyPresent'] = Boolean(getGroqApiKey());
    config['geminiApiKeyPresent'] = Boolean(getGeminiApiKey());
    config['deepseekApiKeyPresent'] = Boolean(getDeepseekApiKey());
    config['aimlApiKeyPresent'] = Boolean(getAimlApiKey());
    config['ollamaApiKeyPresent'] = Boolean(getOllamaApiKey());
    config['customOpenaiApiKeyPresent'] = Boolean(getCustomOpenaiApiKey());

    config['ollamaApiUrl'] = getOllamaApiEndpoint();
    config['lmStudioApiUrl'] = getLMStudioApiEndpoint();
    config['customOpenaiApiUrl'] = getCustomOpenaiApiUrl();
    config['customOpenaiModelName'] = getCustomOpenaiModelName();
    config['chutes'] = {
      apiUrl: getCustomOpenaiApiUrl(),
      apiKeyPresent: !!getCustomOpenaiApiKey(),
      modelName: getCustomOpenaiModelName(),
    };
    config['allowConfigWrite'] = allowConfigWrite;

    return Response.json({ ...config }, { status: 200 });
  } catch (err) {
    console.error('An error occurred while getting config:', err);
    return Response.json(
      { message: 'An error occurred while getting config' },
      { status: 500 },
    );
  }
};

export const POST = async (req: Request) => {
  try {
    if (!allowConfigWrite) {
      return Response.json(
        { message: 'Config updates are disabled in this environment' },
        { status: 403 },
      );
    }

    const config = await req.json();

    const updatedConfig = {
      MODELS: {
        OPENAI: {
          API_KEY: config.openaiApiKey,
        },
        GROQ: {
          API_KEY: config.groqApiKey,
        },
        ANTHROPIC: {
          API_KEY: config.anthropicApiKey,
        },
        GEMINI: {
          API_KEY: config.geminiApiKey,
        },
        OLLAMA: {
          API_URL: config.ollamaApiUrl,
          API_KEY: config.ollamaApiKey,
        },
        DEEPSEEK: {
          API_KEY: config.deepseekApiKey,
        },
        AIMLAPI: {
          API_KEY: config.aimlApiKey,
        },
        LM_STUDIO: {
          API_URL: config.lmStudioApiUrl,
        },
        CUSTOM_OPENAI: {
          API_URL: config.customOpenaiApiUrl,
          API_KEY: config.customOpenaiApiKey,
          MODEL_NAME: config.customOpenaiModelName,
        },
      },
    };

    updateConfig(updatedConfig);

    return Response.json({ message: 'Config updated' }, { status: 200 });
  } catch (err) {
    console.error('An error occurred while updating config:', err);
    return Response.json(
      { message: 'An error occurred while updating config' },
      { status: 500 },
    );
  }
};
