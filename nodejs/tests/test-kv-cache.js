/**
 * @fileoverview Tests for KVCache — caching with TTL and LRU eviction.
 */

const { KVCache } = require('../src/core/kv-cache');

describe('KVCache', () => {
  it('stores and retrieves values', () => {
    const cache = new KVCache(100, 60000);
    cache.set([{ role: 'user', content: 'hello' }], 'world');
    const result = cache.get([{ role: 'user', content: 'hello' }]);
    assert.strictEqual('world', result);
  });

  it('returns null for cache miss', () => {
    const cache = new KVCache(100, 60000);
    const result = cache.get([{ role: 'user', content: 'missing' }]);
    assert.strictEqual(null, result);
  });

  it('returns null for expired entries', () => {
    const cache = new KVCache(100, 1); // 1ms TTL
    cache.set([{ role: 'user', content: 'hello' }], 'world');

    return new Promise(resolve => {
      setTimeout(() => {
        const result = cache.get([{ role: 'user', content: 'hello' }]);
        assert.strictEqual(null, result);
        resolve();
      }, 10);
    });
  });

  it('evicts oldest entry when at capacity', () => {
    const cache = new KVCache(2, 60000);
    cache.set([{ role: 'user', content: 'msg1' }], 'val1');
    cache.set([{ role: 'user', content: 'msg2' }], 'val2');
    cache.set([{ role: 'user', content: 'msg3' }], 'val3');

    assert.strictEqual(null, cache.get([{ role: 'user', content: 'msg1' }]));
    assert.strictEqual('val2', cache.get([{ role: 'user', content: 'msg2' }]));
    assert.strictEqual('val3', cache.get([{ role: 'user', content: 'msg3' }]));
    assert.strictEqual(2, cache.size);
  });

  it('clear() removes all entries', () => {
    const cache = new KVCache(10, 60000);
    cache.set([{ role: 'user', content: 'hello' }], 'world');
    cache.clear();
    assert.strictEqual(0, cache.size);
    assert.strictEqual(null, cache.get([{ role: 'user', content: 'hello' }]));
  });

  it('size property returns correct count', () => {
    const cache = new KVCache(10, 60000);
    assert.strictEqual(0, cache.size);
    cache.set([{ role: 'user', content: 'a' }], '1');
    assert.strictEqual(1, cache.size);
    cache.set([{ role: 'user', content: 'b' }], '2');
    assert.strictEqual(2, cache.size);
  });
});
