const assert = require('node:assert');
const { describe, it, beforeEach, after } = require('node:test');

const cfg = require('./config.ts');

describe('SearXNG endpoints selection (JS)', () => {
  const OLD = process.env;
  beforeEach(() => {
    process.env = { ...OLD };
  });
  after(() => {
    process.env = OLD;
  });

  it('single URL', () => {
    process.env.SEARXNG_API_URL = 'https://example.com';
    process.env.SEARXNG_API_URLS = '';
    const all = cfg.getSearxngApiEndpoints();
    assert.deepEqual(all, ['https://example.com']);
    const picks = new Set(Array.from({ length: 10 }, () => cfg.getSearxngApiEndpoint()));
    assert.equal(picks.size, 1);
  });

  it('multiple URLs', () => {
    process.env.SEARXNG_API_URL = 'https://single.com';
    process.env.SEARXNG_API_URLS = 'https://a.com, https://b.com';
    const all = cfg.getSearxngApiEndpoints().sort();
    assert.deepEqual(all, ['https://a.com', 'https://b.com', 'https://single.com'].sort());
    const picks = Array.from({ length: 30 }, () => cfg.getSearxngApiEndpoint());
    picks.forEach((p) => assert.ok(all.includes(p)));
  });

  it('invalid yields empty', () => {
    delete process.env.SEARXNG_API_URL;
    process.env.SEARXNG_API_URLS = 'not-a-url';
    const all = cfg.getSearxngApiEndpoints();
    assert.deepEqual(all, []);
  });
});

