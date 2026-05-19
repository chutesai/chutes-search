const assert = require('node:assert');
const { describe, it } = require('node:test');

const {
  buildChutesCandidates,
  isFallbackableUpstreamError,
  runWithLlmCandidates,
} = require('./fallbacks.ts');

describe('LLM fallback helpers', () => {
  it('appends Model Router after direct Chutes candidates', () => {
    const candidates = buildChutesCandidates({
      modelNames: [' stale/model ', 'stale/model', 'moonshotai/Kimi-K2.6-TEE'],
      apiKey: 'test-key',
      baseURL: 'https://llm.chutes.ai/v1',
      modelRouterBaseURL: 'https://model-router-ten.vercel.app/v1',
    });

    assert.deepEqual(
      candidates.map((candidate) => candidate.name),
      [
        'stale/model',
        'moonshotai/Kimi-K2.6-TEE',
        'model-router (Model Router)',
      ],
    );
  });

  it('treats deleted-model and token-cap errors as fallbackable', () => {
    assert.equal(
      isFallbackableUpstreamError(
        new Error('404 status code (no body) MODEL_NOT_FOUND'),
      ),
      true,
    );
    assert.equal(
      isFallbackableUpstreamError(
        new Error(
          'Requested token count exceeds the model maximum context length',
        ),
      ),
      true,
    );
  });

  it('runs the next candidate after a fallbackable failure', async () => {
    const candidates = [
      { name: 'deleted/model', model: {} },
      { name: 'model-router (Model Router)', model: {} },
    ];
    const tried = [];

    const result = await runWithLlmCandidates(candidates, async (candidate) => {
      tried.push(candidate.name);
      if (candidate.name === 'deleted/model') {
        throw new Error('404 status code (no body)');
      }
      return 'ok';
    });

    assert.equal(result, 'ok');
    assert.deepEqual(tried, ['deleted/model', 'model-router (Model Router)']);
  });
});
