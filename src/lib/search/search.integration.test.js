const assert = require('node:assert');
const { test } = require('node:test');
const { searchDesearch } = require('../desearch.ts');

const apiKey = process.env.DESEARCH_API_KEY;
const maybeTest = apiKey ? test : test.skip;

maybeTest('desearch returns results for common query', async () => {
  const r = await searchDesearch('who is sam altman');
  assert.ok(Array.isArray(r.results));
  assert.ok(r.results.length > 0, 'expected non-empty results from desearch');
});
