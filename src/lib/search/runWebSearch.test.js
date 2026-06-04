const assert = require('node:assert');
const { test } = require('node:test');
const { runWebSearch } = require('./runWebSearch');

const emptyProvider = async () => ({ results: [], suggestions: [] });

test('uses desearch (preferred) when its results are relevant', async () => {
  let serperCalled = false;
  let searxngCalled = false;
  const res = await runWebSearch('ukraine negotiations', [], {
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
    searchSearxngFn: async () => {
      searxngCalled = true;
      return emptyProvider();
    },
  });

  assert.equal(res.engine, 'desearch');
  assert.equal(res.results.length, 3);
  assert.equal(serperCalled, false);
  assert.equal(searxngCalled, false);
});

test('falls back to serper when desearch returns off-topic junk', async () => {
  let serperCalled = false;
  const res = await runWebSearch('ukraine negotiations', [], {
    searchDesearchFn: async () => ({
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
    searchSearxngFn: emptyProvider,
  });

  assert.equal(serperCalled, true);
  assert.equal(res.engine, 'serper');
  assert.equal(res.results.length, 2);
});

test('falls back to serper when desearch is empty', async () => {
  const res = await runWebSearch('ukraine negotiations', [], {
    searchDesearchFn: emptyProvider,
    searchSerperFn: async () => ({
      results: [
        { title: 'CFR', url: 'https://www.cfr.org/x', content: 'ukraine negotiations' },
      ],
      suggestions: [],
    }),
    searchSearxngFn: emptyProvider,
  });

  assert.equal(res.engine, 'serper');
  assert.equal(res.results.length, 1);
});

test('uses searxng only as a last resort', async () => {
  const res = await runWebSearch('ukraine war', [], {
    searchDesearchFn: emptyProvider,
    searchSerperFn: emptyProvider,
    searchSearxngFn: async () => ({
      results: [
        {
          title: 'Ukraine war news',
          url: 'https://example.com',
          content: 'ukraine',
          thumbnail_src: 'thumb.png',
        },
      ],
      suggestions: ['searx-hint'],
    }),
  });

  assert.equal(res.engine, 'searxng');
  assert.equal(res.results.length, 1);
  assert.equal(res.results[0].thumbnail, 'thumb.png');
});

test('surfaces errors when all providers fail', async () => {
  const res = await runWebSearch('ukraine negotiations', [], {
    searchDesearchFn: async () => ({
      results: [],
      suggestions: [],
      error: 'Desearch credits exhausted',
    }),
    searchSerperFn: emptyProvider,
    searchSearxngFn: async () => {
      const err = new Error('rate limit');
      err.response = { status: 429 };
      throw err;
    },
  });

  assert.equal(res.engine, 'desearch');
  assert.equal(res.results.length, 0);
  assert.equal(res.error, 'Desearch credits exhausted');
});

test('video focus mode uses Serper videos', async () => {
  let desearchCalled = false;
  const res = await runWebSearch('docker tutorial', ['youtube'], {
    searchSerperVideosFn: async () => ({
      results: [
        { title: 'Learn Docker in 8 Minutes', url: 'https://www.youtube.com/watch?v=abc' },
        { title: 'Docker basics', url: 'https://www.youtube.com/watch?v=def' },
      ],
      suggestions: [],
    }),
    searchDesearchFn: async () => {
      desearchCalled = true;
      return emptyProvider();
    },
    searchSerperFn: emptyProvider,
    searchSearxngFn: emptyProvider,
  });

  assert.equal(res.engine, 'serper');
  assert.equal(res.results.length, 2);
  assert.ok(res.results.every((r) => r.url.includes('youtube.com')));
  assert.equal(desearchCalled, false);
});

test('keeps relevant YouTube results (does not hard-drop videos)', async () => {
  const res = await runWebSearch('docker tutorial', [], {
    searchDesearchFn: async () => ({
      results: [
        { title: 'Docker explained', url: 'https://www.youtube.com/watch?v=dckr', content: 'docker' },
        { title: 'Docker docs', url: 'https://docs.docker.com', content: 'docker tutorial' },
        { title: 'Docker guide', url: 'https://example.com/docker', content: 'docker' },
      ],
      suggestions: [],
    }),
    searchSerperFn: emptyProvider,
    searchSearxngFn: emptyProvider,
  });

  assert.equal(res.engine, 'desearch');
  assert.equal(res.results.length, 3);
  assert.ok(res.results.some((r) => r.url.includes('youtube.com')));
});
