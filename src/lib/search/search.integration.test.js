const assert = require('node:assert');
const { test } = require('node:test');
const { searchSerper } = require('../serper.ts');

const apiKey = process.env.SERPER_API_KEY;
const maybeTest = apiKey ? test : test.skip;

maybeTest('serper returns results for common query', async () => {
  const r = await searchSerper('who is sam altman');
  assert.ok(Array.isArray(r.results));
  assert.ok(r.results.length > 0, 'expected non-empty results from serper');
});

