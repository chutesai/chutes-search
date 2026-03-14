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
      speed: 'openai/gpt-oss-20b',
      quality: 'deepseek-ai/DeepSeek-V3.2-TEE',
    };

    assert.equal(
      searchModeModels.resolveOptimizationModeModelName('speed', preferences),
      'openai/gpt-oss-20b',
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
});
