const assert = require('node:assert');
const { test } = require('node:test');
const { runWebSearch } = require('./runWebSearch');

const noopSerper = async () => ({ results: [], suggestions: [] });

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
    searchSerperFn: noopSerper,
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
        { title: 'D1', url: 'https://a.example', content: 'body' },
        { title: 'D2', url: 'https://b.example', content: 'body' },
        { title: 'D3', url: 'https://c.example', content: 'body' },
      ],
      suggestions: ['desearch-hint'],
    }),
    searchSerperFn: noopSerper,
  });

  assert.equal(res.engine, 'desearch');
  assert.equal(res.results.length, 3);
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
    searchSerperFn: noopSerper,
  });

  assert.equal(res.engine, 'desearch');
  assert.equal(desearchCalls, 1);
});

test('surfaces errors when all providers fail', async () => {
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
    searchSerperFn: noopSerper,
  });

  assert.equal(res.engine, 'desearch');
  assert.equal(res.results.length, 0);
  assert.equal(res.error, 'Desearch credits exhausted');
});

test('drops YouTube results for non-video web search', async () => {
  const res = await runWebSearch('query', [], {
    searchSearxngFn: async () => ({
      results: [
        { title: 'Vid', url: 'https://www.youtube.com/watch?v=abc' },
        { title: 'Real', url: 'https://en.wikipedia.org/wiki/Topic' },
      ],
      suggestions: [],
    }),
    searchDesearchFn: noopSerper,
    searchSerperFn: noopSerper,
  });

  assert.equal(res.engine, 'searxng');
  assert.equal(res.results.length, 1);
  assert.equal(res.results[0].url, 'https://en.wikipedia.org/wiki/Topic');
});

test('keeps YouTube results when youtube is an active engine', async () => {
  const res = await runWebSearch('query', ['youtube'], {
    searchSearxngFn: async () => ({
      results: [
        { title: 'Vid', url: 'https://www.youtube.com/watch?v=abc' },
        { title: 'Vid2', url: 'https://youtu.be/xyz' },
      ],
      suggestions: [],
    }),
    searchDesearchFn: noopSerper,
    searchSerperFn: noopSerper,
  });

  assert.equal(res.engine, 'searxng');
  assert.equal(res.results.length, 2);
});

test('falls back to serper when desearch returns mostly YouTube junk', async () => {
  let serperCalled = false;

  const res = await runWebSearch('query', [], {
    searchSearxngFn: async () => ({ results: [], suggestions: [] }),
    searchDesearchFn: async () => ({
      // A full page of unrelated videos — exactly the production failure mode.
      results: Array.from({ length: 18 }, (_, i) => ({
        title: `What is thing ${i}`,
        url: `https://www.youtube.com/watch?v=vid${i}`,
      })),
      suggestions: [],
    }),
    searchSerperFn: async () => {
      serperCalled = true;
      return {
        results: [
          { title: 'CFR', url: 'https://www.cfr.org/x', content: 'c' },
          { title: 'BBC', url: 'https://www.bbc.com/news/y', content: 'c' },
        ],
        suggestions: [],
      };
    },
  });

  assert.equal(serperCalled, true);
  assert.equal(res.engine, 'serper');
  assert.equal(res.results.length, 2);
  assert.equal(res.results[0].url, 'https://www.cfr.org/x');
});
