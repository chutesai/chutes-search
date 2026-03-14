const assert = require('node:assert');
const { describe, it } = require('node:test');

const canonicalHost = require('./canonicalHost.ts');

describe('canonical search host redirects', () => {
  it('redirects legacy .com hosts to the canonical domain', () => {
    assert.equal(
      canonicalHost.getCanonicalSearchHostRedirect('chutes-search.com'),
      canonicalHost.SEARCH_CANONICAL_HOST,
    );
    assert.equal(
      canonicalHost.getCanonicalSearchHostRedirect('www.chutes-search.com'),
      canonicalHost.SEARCH_CANONICAL_HOST,
    );
  });

  it('leaves the canonical host unchanged', () => {
    assert.equal(
      canonicalHost.getCanonicalSearchHostRedirect('search.chutes.ai'),
      null,
    );
  });
});
