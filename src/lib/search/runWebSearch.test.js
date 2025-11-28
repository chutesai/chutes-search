const assert = require('node:assert');
const { test } = require('node:test');
const { runWebSearch } = require('./runWebSearch');

test('prefers searxng when it returns results', async () => {
  let serperCalled = false;

  const res = await runWebSearch('query', ['web'], {
    searchSearxngFn: async () => ({
      results: [
        {
          title: 'Example hit',
          url: 'https://example.com',
          content: 'snippet',
          thumbnail_src: 'thumb.png',
        },
      ],
      suggestions: ['suggestion'],
    }),
    searchSerperFn: async () => {
      serperCalled = true;
      return { results: [], suggestions: [] };
    },
  });

  assert.equal(res.engine, 'searxng');
  assert.equal(res.results.length, 1);
  assert.equal(res.results[0].url, 'https://example.com');
  assert.equal(res.results[0].thumbnail, 'thumb.png');
  assert.deepEqual(res.suggestions, ['suggestion']);
  assert.equal(serperCalled, false);
});

test('falls back to serper when searxng has no results', async () => {
  const res = await runWebSearch('query', [], {
    searchSearxngFn: async () => ({
      results: [],
      suggestions: ['searx-hint'],
    }),
    searchSerperFn: async () => ({
      results: [
        { title: 'Serper hit', url: 'https://serper.dev', content: 'body' },
      ],
      suggestions: ['serper-hint'],
    }),
  });

  assert.equal(res.engine, 'serper');
  assert.equal(res.results.length, 1);
  assert.equal(res.results[0].title, 'Serper hit');
  assert.deepEqual(
    res.suggestions.sort(),
    ['searx-hint', 'serper-hint'].sort(),
  );
});

test('falls back to serper when searxng throws', async () => {
  let serperCalls = 0;

  const res = await runWebSearch('query', [], {
    searchSearxngFn: async () => {
      throw new Error('boom');
    },
    searchSerperFn: async () => {
      serperCalls += 1;
      return { results: [], suggestions: [] };
    },
  });

  assert.equal(res.engine, 'serper');
  assert.equal(serperCalls, 1);
});

test('surfaces errors when both providers fail', async () => {
  const res = await runWebSearch('query', [], {
    searchSearxngFn: async () => {
      const err = new Error('rate limit');
      err.response = { status: 429 };
      throw err;
    },
    searchSerperFn: async () => ({
      results: [],
      suggestions: [],
      error: 'Serper credits exhausted',
    }),
  });

  assert.equal(res.engine, 'serper');
  assert.equal(res.results.length, 0);
  assert.equal(res.error, 'Serper credits exhausted');
});
