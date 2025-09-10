import { getSearxngApiEndpoint, getSearxngApiEndpoints } from './config';

describe('SearXNG endpoints selection', () => {
  const OLD_ENV = process.env;
  beforeEach(() => {
    process.env = { ...OLD_ENV };
  });
  afterAll(() => {
    process.env = OLD_ENV;
  });

  test('single URL', () => {
    process.env.SEARXNG_API_URL = 'https://example.com';
    process.env.SEARXNG_API_URLS = '';
    expect(getSearxngApiEndpoints()).toEqual(['https://example.com']);
    const s = new Set(Array.from({ length: 10 }, () => getSearxngApiEndpoint()));
    expect(s.size).toBe(1);
  });

  test('multiple URLs', () => {
    process.env.SEARXNG_API_URL = 'https://single.com';
    process.env.SEARXNG_API_URLS = 'https://a.com, https://b.com';
    const all = getSearxngApiEndpoints();
    expect(all.sort()).toEqual(['https://a.com', 'https://b.com', 'https://single.com'].sort());
    const picks = Array.from({ length: 50 }, () => getSearxngApiEndpoint());
    // ensure picks are among list
    picks.forEach((p) => expect(all).toContain(p));
  });

  test('invalid env yields empty list', () => {
    delete process.env.SEARXNG_API_URL;
    process.env.SEARXNG_API_URLS = 'not-a-url';
    expect(getSearxngApiEndpoints()).toEqual([]);
  });
});


