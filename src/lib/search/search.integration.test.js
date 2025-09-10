const assert = require('node:assert');
const { test } = require('node:test');
const { searchSerper } = require('../serper.js');

test('serper returns results for common query', async () => {
  process.env.SERPER_API_KEY = process.env.SERPER_API_KEY || '434c62507ed3c1460a4ef69c3b8381c004ee77ae';
  const r = await searchSerper('who is sam altman');
  assert.ok(Array.isArray(r.results));
  assert.ok(r.results.length > 0, 'expected non-empty results from serper');
});


