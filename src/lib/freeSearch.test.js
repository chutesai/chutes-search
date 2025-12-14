const assert = require('node:assert');
const { describe, it } = require('node:test');

const free = require('./freeSearch.ts');

function makeStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, v),
    removeItem: (k) => map.delete(k),
  };
}

describe('freeSearch', () => {
  it('starts at 0 for new day', () => {
    const storage = makeStorage();
    const state = free.readFreeSearchState(storage, new Date('2025-01-02T12:00:00'));
    assert.deepEqual(state, { date: '2025-01-02', count: 0 });
  });

  it('resets when date changes', () => {
    const storage = makeStorage();
    free.writeFreeSearchState(storage, { date: '2025-01-02', count: 2 });
    const state = free.readFreeSearchState(storage, new Date('2025-01-03T01:00:00'));
    assert.deepEqual(state, { date: '2025-01-03', count: 0 });
  });

  it('increments and persists', () => {
    const storage = makeStorage();
    const a = free.incrementFreeSearchState(storage, new Date('2025-01-02T12:00:00'));
    const b = free.incrementFreeSearchState(storage, new Date('2025-01-02T12:00:00'));
    assert.equal(a.count, 1);
    assert.equal(b.count, 2);
    const state = free.readFreeSearchState(storage, new Date('2025-01-02T12:00:00'));
    assert.equal(state.count, 2);
  });
});

