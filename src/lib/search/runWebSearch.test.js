const assert = require('node:assert');
const { test } = require('node:test');
const { runWebSearch } = require('./runWebSearch');

test('prefers searxng when it returns results', async () => {
  let desearchCalled = false;

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
    searchDesearchFn: async () => {
      desearchCalled = true;
      return { results: [], suggestions: [] };
    },
  });

  assert.equal(res.engine, 'searxng');
  assert.equal(res.results.length, 1);
  assert.equal(res.results[0].url, 'https://example.com');
  assert.equal(res.results[0].thumbnail, 'thumb.png');
  assert.deepEqual(res.suggestions, ['suggestion']);
  assert.equal(desearchCalled, false);
});

test('falls back to desearch when searxng has no results', async () => {
  const res = await runWebSearch('query', [], {
    searchSearxngFn: async () => ({
      results: [],
      suggestions: ['searx-hint'],
    }),
    searchDesearchFn: async () => ({
      results: [
        { title: 'Desearch hit', url: 'https://desearch.ai', content: 'body' },
      ],
      suggestions: ['desearch-hint'],
    }),
  });

  assert.equal(res.engine, 'desearch');
  assert.equal(res.results.length, 1);
  assert.equal(res.results[0].title, 'Desearch hit');
  assert.deepEqual(
    res.suggestions.sort(),
    ['searx-hint', 'desearch-hint'].sort(),
  );
});

test('falls back to desearch when searxng throws', async () => {
  let desearchCalls = 0;

  const res = await runWebSearch('query', [], {
    searchSearxngFn: async () => {
      throw new Error('boom');
    },
    searchDesearchFn: async () => {
      desearchCalls += 1;
      return { results: [], suggestions: [] };
    },
  });

  assert.equal(res.engine, 'desearch');
  assert.equal(desearchCalls, 1);
});

test('surfaces errors when both providers fail', async () => {
  const res = await runWebSearch('query', [], {
    searchSearxngFn: async () => {
      const err = new Error('rate limit');
      err.response = { status: 429 };
      throw err;
    },
    searchDesearchFn: async () => ({
      results: [],
      suggestions: [],
      error: 'Desearch credits exhausted',
    }),
  });

  assert.equal(res.engine, 'desearch');
  assert.equal(res.results.length, 0);
  assert.equal(res.error, 'Desearch credits exhausted');
});
