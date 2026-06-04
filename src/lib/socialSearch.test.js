const assert = require('node:assert');
const { test } = require('node:test');
const {
  searchSocial,
  socialPostsToContext,
  SOCIAL_CONTEXT_HEADER,
} = require('./socialSearch');

const tweet = (over = {}) => ({
  platform: 'x',
  author: '@nasa',
  text: 'mars rover update',
  url: 'https://x.com/nasa/status/1',
  provider: 'desearch-sn22',
  ...over,
});

const redditPost = (over = {}) => ({
  platform: 'reddit',
  author: 'u/space_fan',
  community: 'r/space',
  title: 'Mars rover thread',
  text: 'discussion about the mars rover',
  url: 'https://www.reddit.com/r/space/comments/1/mars',
  provider: 'macrocosmos-sn13',
  ...over,
});

test('merges X + reddit, relevance-filters, and caps results', async () => {
  const res = await searchSocial('mars rover', {
    searchXFn: async () => [
      tweet(),
      tweet({ text: 'totally unrelated cooking recipe', url: 'https://x.com/x/status/2' }),
    ],
    searchRedditMacrocosmosFn: async () => [redditPost()],
    searchRedditDesearchFn: async () => [],
  });

  // The off-topic tweet is dropped by the relevance filter.
  assert.equal(res.tweets.length, 1);
  assert.equal(res.tweets[0].url, 'https://x.com/nasa/status/1');
  assert.equal(res.reddit.length, 1);
  assert.deepEqual(res.errors, []);
});

test('a failing provider never throws and is recorded as an error', async () => {
  const res = await searchSocial('mars rover', {
    searchXFn: async () => {
      throw new Error('boom');
    },
    searchRedditMacrocosmosFn: async () => [redditPost()],
    searchRedditDesearchFn: async () => [],
  });

  assert.equal(res.tweets.length, 0);
  assert.equal(res.reddit.length, 1);
  assert.equal(res.errors.length, 1);
  assert.match(res.errors[0], /x\/desearch/);
});

test('reddit results from both providers are deduped by url', async () => {
  const res = await searchSocial('mars rover', {
    searchXFn: async () => [],
    searchRedditMacrocosmosFn: async () => [redditPost()],
    searchRedditDesearchFn: async () => [
      redditPost({ provider: 'desearch-sn22', text: 'mars rover dupe' }),
    ],
  });
  assert.equal(res.reddit.length, 1);
});

test('socialPostsToContext numbers from startIndex and includes the low-trust header', () => {
  const ctx = socialPostsToContext([redditPost(), tweet()], 5);
  assert.ok(ctx.startsWith(SOCIAL_CONTEXT_HEADER));
  // Continues numbering after 5 web sources => 6, 7.
  assert.match(ctx, /\n6\. \[social\/reddit\]/);
  assert.match(ctx, /\n7\. \[social\/x\]/);
});

test('socialPostsToContext is empty when there are no posts', () => {
  assert.equal(socialPostsToContext([], 0), '');
});
