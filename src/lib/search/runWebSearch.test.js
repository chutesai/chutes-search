const assert = require('node:assert');
const { test } = require('node:test');
const { runWebSearch } = require('./runWebSearch');

const emptyProvider = async () => ({ results: [], suggestions: [] });

test('prefers searxng when it returns results', async () => {
  let desearchCalled = false;

  const res = await runWebSearch('ukraine war', ['web'], {
    searchSearxngFn: async () => ({
      results: [
        {
          title: 'Ukraine war news',
          url: 'https://example.com',
          content: 'snippet about ukraine',
          thumbnail_src: 'thumb.png',
        },
      ],
      suggestions: ['suggestion'],
    }),
    searchDesearchFn: async () => {
      desearchCalled = true;
      return { results: [], suggestions: [] };
    },
    searchSerperFn: emptyProvider,
  });

  assert.equal(res.engine, 'searxng');
  assert.equal(res.results.length, 1);
  assert.equal(res.results[0].thumbnail, 'thumb.png');
  assert.deepEqual(res.suggestions, ['suggestion']);
  assert.equal(desearchCalled, false);
});

test('uses desearch when its results are relevant to the query', async () => {
  let serperCalled = false;
  const res = await runWebSearch('ukraine negotiations', [], {
    searchSearxngFn: async () => ({ results: [], suggestions: ['searx-hint'] }),
    searchDesearchFn: async () => ({
      results: [
        { title: 'Ukraine peace negotiations', url: 'https://a.example', content: 'x' },
        { title: 'Negotiations latest', url: 'https://b.example', content: 'ukraine talks' },
        { title: 'Ukraine update', url: 'https://c.example', content: 'negotiations' },
      ],
      suggestions: ['desearch-hint'],
    }),
    searchSerperFn: async () => {
      serperCalled = true;
      return emptyProvider();
    },
  });

  assert.equal(res.engine, 'desearch');
  assert.equal(res.results.length, 3);
  assert.equal(serperCalled, false);
  assert.deepEqual(res.suggestions.sort(), ['desearch-hint', 'searx-hint']);
});

test('falls back through desearch to serper when searxng throws', async () => {
  let desearchCalls = 0;
  const res = await runWebSearch('ukraine negotiations', [], {
    searchSearxngFn: async () => {
      throw new Error('boom');
    },
    searchDesearchFn: async () => {
      desearchCalls += 1;
      return { results: [], suggestions: [] };
    },
    searchSerperFn: emptyProvider,
  });

  assert.equal(res.engine, 'desearch');
  assert.equal(desearchCalls, 1);
});

test('surfaces errors when all providers fail', async () => {
  const res = await runWebSearch('ukraine negotiations', [], {
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
    searchSerperFn: emptyProvider,
  });

  assert.equal(res.engine, 'desearch');
  assert.equal(res.results.length, 0);
  assert.equal(res.error, 'Desearch credits exhausted');
});

test('falls back to serper when desearch returns off-topic junk', async () => {
  let serperCalled = false;
  const res = await runWebSearch('ukraine negotiations', [], {
    searchSearxngFn: async () => ({ results: [], suggestions: [] }),
    searchDesearchFn: async () => ({
      // A full page of unrelated videos — the production failure mode. None
      // mention "ukraine"/"negotiations", so relevantCount is 0.
      results: Array.from({ length: 18 }, (_, i) => ({
        title: `What is thing ${i}`,
        url: `https://www.youtube.com/watch?v=vid${i}`,
        content: 'favorite gum',
      })),
      suggestions: [],
    }),
    searchSerperFn: async () => {
      serperCalled = true;
      return {
        results: [
          { title: 'CFR Ukraine', url: 'https://www.cfr.org/x', content: 'negotiations' },
          { title: 'BBC Ukraine', url: 'https://www.bbc.com/y', content: 'ukraine' },
        ],
        suggestions: [],
      };
    },
  });

  assert.equal(serperCalled, true);
  assert.equal(res.engine, 'serper');
  assert.equal(res.results.length, 2);
});

test('keeps relevant YouTube results (does not hard-drop videos)', async () => {
  const res = await runWebSearch('docker tutorial', [], {
    searchSearxngFn: async () => ({ results: [], suggestions: [] }),
    searchDesearchFn: async () => ({
      results: [
        { title: 'Docker explained', url: 'https://www.youtube.com/watch?v=dckr', content: 'docker' },
        { title: 'Docker docs', url: 'https://docs.docker.com', content: 'docker tutorial' },
        { title: 'Docker guide', url: 'https://example.com/docker', content: 'docker' },
      ],
      suggestions: [],
    }),
    searchSerperFn: emptyProvider,
  });

  assert.equal(res.engine, 'desearch');
  assert.equal(res.results.length, 3);
  assert.ok(res.results.some((r) => r.url.includes('youtube.com')));
});
