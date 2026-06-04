const assert = require('node:assert');
const { describe, it } = require('node:test');

const searchModeModels = require('./searchModeModels.ts');

describe('search mode model preferences', () => {
  it('falls back to defaults for invalid values', () => {
    assert.equal(
      searchModeModels.sanitizeSearchModeModel('speed', 'invalid/model'),
      searchModeModels.DEFAULT_SPEED_MODEL,
    );
    assert.equal(
      searchModeModels.sanitizeSearchModeModel('quality', 'invalid/model'),
      searchModeModels.DEFAULT_QUALITY_MODEL,
    );
  });

  it('resolves speed and quality presets independently', () => {
    const preferences = {
      speed: 'Qwen/Qwen3-32B-TEE',
      quality: 'deepseek-ai/DeepSeek-V3.2-TEE',
    };

    assert.equal(
      searchModeModels.resolveOptimizationModeModelName('speed', preferences),
      'Qwen/Qwen3-32B-TEE',
    );
    assert.equal(
      searchModeModels.resolveOptimizationModeModelName(
        'balanced',
        preferences,
      ),
      'deepseek-ai/DeepSeek-V3.2-TEE',
    );
    assert.equal(
      searchModeModels.resolveOptimizationModeModelName('quality', preferences),
      'deepseek-ai/DeepSeek-V3.2-TEE',
    );
  });

  it('caps response tokens by optimization mode while preserving deep research room', () => {
    assert.equal(
      searchModeModels.resolveOptimizationModeMaxTokens('speed'),
      500,
    );
    assert.equal(
      searchModeModels.resolveOptimizationModeMaxTokens('balanced'),
      1200,
    );
    assert.equal(
      searchModeModels.resolveOptimizationModeMaxTokens('quality'),
      1600,
    );
    assert.equal(
      searchModeModels.resolveOptimizationModeMaxTokens('speed', {
        focusMode: 'deepResearch',
        deepResearchMode: 'max',
      }),
      3200,
    );
  });

  it('only exposes model choices that are present in the live Chutes catalog snapshot', () => {
    const liveModels = new Set(searchModeModels.LIVE_CHUTES_MODEL_IDS);
    const configuredModels = [
      ...searchModeModels.SPEED_MODELS,
      ...searchModeModels.QUALITY_MODELS,
      ...searchModeModels.SEARCH_FALLBACK_MODELS,
      ...searchModeModels.DEEP_RESEARCH_SUMMARY_MODELS,
      ...searchModeModels.AUXILIARY_LLM_MODELS,
    ];

    assert.deepEqual(
      configuredModels.filter((model) => !liveModels.has(model)),
      [],
    );
  });

  it('does not keep known deleted Chutes model IDs in active model lists', () => {
    const deletedModels = new Set([
      'Qwen/Qwen3-Next-80B-A3B-Instruct',
      'unsloth/gemma-3-27b-it',
      'unsloth/Mistral-Nemo-Instruct-2407',
      'XiaomiMiMo/MiMo-V2-Flash-TEE',
      'openai/gpt-oss-120b-TEE',
      'chutesai/Mistral-Small-3.2-24B-Instruct-2506',
      'openai/gpt-oss-20b',
      'NousResearch/Hermes-4-14B',
      'deepseek-ai/DeepSeek-V3',
      'Qwen/Qwen2.5-72B-Instruct',
      'NousResearch/Hermes-4-70B',
      'Qwen/Qwen3-VL-235B-A22B-Instruct',
      'zai-org/GLM-5-Turbo',
      'Qwen/Qwen2.5-Coder-32B-Instruct-TEE',
      'Qwen/Qwen3-235B-A22B-Thinking-2507',
    ]);
    const configuredModels = [
      ...searchModeModels.SPEED_MODELS,
      ...searchModeModels.QUALITY_MODELS,
      ...searchModeModels.SEARCH_FALLBACK_MODELS,
      ...searchModeModels.DEEP_RESEARCH_SUMMARY_MODELS,
      ...searchModeModels.AUXILIARY_LLM_MODELS,
    ];

    assert.deepEqual(
      configuredModels.filter((model) => deletedModels.has(model)),
      [],
    );
  });
});
