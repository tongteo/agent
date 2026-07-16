/**
 * @fileoverview Tests for KVCache — true LRU, hash keys, TTL, metrics, pruning.
 */

const { KVCache } = require('../src/core/kv-cache');

const msgs = (content) => [{ role: 'user', content }];

describe('KVCache', () => {
  // ── Basic operations ──

  it('stores and retrieves values', () => {
    const cache = new KVCache(100, 60000);
    cache.set(msgs('hello'), 'world');
    assert.strictEqual('world', cache.get(msgs('hello')));
  });

  it('returns null for cache miss', () => {
    const cache = new KVCache(100, 60000);
    assert.strictEqual(null, cache.get(msgs('missing')));
  });

  it('returns null for expired entries', () => {
    const cache = new KVCache({ maxSize: 100, ttlMs: 1 });
    cache.set(msgs('hello'), 'world');
    return new Promise(resolve => {
      setTimeout(() => {
        assert.strictEqual(null, cache.get(msgs('hello')));
        resolve();
      }, 10);
    });
  });

  // ── True LRU ──

  it('LRU: get() promotes entry (stays alive when older entries exist)', () => {
    const cache = new KVCache({ maxSize: 2, ttlMs: 60000 });
    cache.set(msgs('a'), 'A');
    cache.set(msgs('b'), 'B');

    // Access 'a' — promotes it to most-recently-used
    cache.get(msgs('a'));

    // Add 'c' — should evict 'b' (least recently used), not 'a'
    cache.set(msgs('c'), 'C');

    assert.strictEqual('A', cache.get(msgs('a')));  // still alive
    assert.strictEqual(null, cache.get(msgs('b')));  // evicted
    assert.strictEqual('C', cache.get(msgs('c')));
  });

  it('evicts LRU entry when at capacity', () => {
    const cache = new KVCache({ maxSize: 2, ttlMs: 60000 });
    cache.set(msgs('msg1'), 'val1');
    cache.set(msgs('msg2'), 'val2');
    cache.set(msgs('msg3'), 'val3');

    assert.strictEqual(null, cache.get(msgs('msg1')));
    assert.strictEqual('val2', cache.get(msgs('msg2')));
    assert.strictEqual('val3', cache.get(msgs('msg3')));
    assert.strictEqual(2, cache.size);
  });

  // ── Hash key ──

  it('hashes full messages array as key', () => {
    const cache = new KVCache(100, 60000);
    const fullMsgs = [
      { role: 'system', content: 'You are helpful' },
      { role: 'user', content: 'hello' },
    ];
    cache.set(fullMsgs, 'response');
    assert.strictEqual('response', cache.get(fullMsgs));
  });

  it('different messages produce different keys', () => {
    const cache = new KVCache(100, 60000);
    cache.set(msgs('hello'), 'resp1');
    cache.set(msgs('world'), 'resp2');
    assert.strictEqual('resp1', cache.get(msgs('hello')));
    assert.strictEqual('resp2', cache.get(msgs('world')));
  });

  it('message order matters', () => {
    const cache = new KVCache(100, 60000);
    const a = [{ role: 'user', content: 'hi' }, { role: 'assistant', content: 'hey' }];
    const b = [{ role: 'assistant', content: 'hey' }, { role: 'user', content: 'hi' }];
    cache.set(a, 'A');
    cache.set(b, 'B');
    assert.strictEqual('A', cache.get(a));
    assert.strictEqual('B', cache.get(b));
  });

  it('200-char slice no longer needed — full content hashed', () => {
    const cache = new KVCache(100, 60000);
    const longContent = 'x'.repeat(500);
    const shortContent = longContent.slice(0, 200);
    cache.set(msgs(longContent), 'long');
    // Different content → different key
    assert.strictEqual(null, cache.get(msgs(shortContent)));
    assert.strictEqual('long', cache.get(msgs(longContent)));
  });

  // ── Clear ──

  it('clear() removes all entries', () => {
    const cache = new KVCache(100, 60000);
    cache.set(msgs('hello'), 'world');
    cache.clear();
    assert.strictEqual(0, cache.size);
    assert.strictEqual(null, cache.get(msgs('hello')));
  });

  it('clear() resets metrics', () => {
    const cache = new KVCache({ maxSize: 100, ttlMs: 60000 });
    cache.set(msgs('a'), 'A');
    cache.get(msgs('a'));
    cache.get(msgs('miss'));
    assert.ok(cache.stats.hits > 0);
    assert.ok(cache.stats.misses > 0);
    cache.clear();
    assert.strictEqual(0, cache.stats.hits);
    assert.strictEqual(0, cache.stats.misses);
  });

  // ── Size ──

  it('size property returns correct count', () => {
    const cache = new KVCache(100, 60000);
    assert.strictEqual(0, cache.size);
    cache.set(msgs('a'), '1');
    assert.strictEqual(1, cache.size);
    cache.set(msgs('b'), '2');
    assert.strictEqual(2, cache.size);
  });

  // ── Metrics ──

  it('tracks hit/miss stats', () => {
    const cache = new KVCache({ maxSize: 100, ttlMs: 60000 });
    cache.set(msgs('a'), 'A');

    cache.get(msgs('a'));   // hit
    cache.get(msgs('a'));   // hit
    cache.get(msgs('b'));   // miss

    const m = cache.getMetrics();
    assert.strictEqual(2, m.hits);
    assert.strictEqual(1, m.misses);
    assert.strictEqual('66.7%', m.hitRate);
    assert.strictEqual(3, m.totalRequests);
  });

  it('tracks evictions', () => {
    const cache = new KVCache({ maxSize: 2, ttlMs: 60000 });
    cache.set(msgs('a'), 'A');
    cache.set(msgs('b'), 'B');
    cache.set(msgs('c'), 'C'); // evicts 'a'
    cache.set(msgs('d'), 'D'); // evicts 'b'

    const m = cache.getMetrics();
    assert.strictEqual(2, m.evictions);
  });

  it('statsString() returns human-readable summary', () => {
    const cache = new KVCache({ maxSize: 50, ttlMs: 60000 });
    cache.set(msgs('x'), 'y');
    const str = cache.statsString();
    assert.ok(str.includes('1/50'));
    assert.ok(str.includes('KVCache'));
  });

  it('tracks per-entry hit count', () => {
    const cache = new KVCache({ maxSize: 100, ttlMs: 60000 });
    cache.set(msgs('a'), 'A');
    cache.get(msgs('a'));
    cache.get(msgs('a'));
    // Entry should have hits=2 (2 get() calls)
    const entry = cache.cache.get(cache._key(msgs('a')));
    assert.strictEqual(2, entry.hits);
  });

  // ── Update existing key ──

  it('set() updates existing key without changing size', () => {
    const cache = new KVCache(100, 60000);
    cache.set(msgs('a'), 'v1');
    assert.strictEqual(1, cache.size);
    cache.set(msgs('a'), 'v2');
    assert.strictEqual(1, cache.size);
    assert.strictEqual('v2', cache.get(msgs('a')));
  });

  // ── Backward compat constructor ──

  it('accepts positional args (backward compat)', () => {
    const cache = new KVCache(50, 60000);
    assert.strictEqual(50, cache.maxSize);
    assert.strictEqual(60000, cache.ttlMs);
  });

  // ── Periodic pruning ──

  it('prunes expired entries periodically', () => {
    const cache = new KVCache({ maxSize: 100, ttlMs: 1, cleanupInterval: 3 });
    cache.set(msgs('a'), 'A');
    cache.set(msgs('b'), 'B');
    // Third set triggers prune — but both entries may still be < 1ms old
    // So we wait and then trigger via the next set
    return new Promise(resolve => {
      setTimeout(() => {
        cache.set(msgs('c'), 'C'); // triggers prune (3rd set since last prune)
        // a and b should be pruned (TTL=1ms, waited >1ms)
        assert.strictEqual(null, cache.get(msgs('a')));
        assert.strictEqual(null, cache.get(msgs('b')));
        assert.strictEqual('C', cache.get(msgs('c')));
        resolve();
      }, 5);
    });
  });

  // ── Metrics disabled ──

  it('metrics can be disabled', () => {
    const cache = new KVCache({ maxSize: 100, ttlMs: 60000, metrics: false });
    cache.set(msgs('a'), 'A');
    cache.get(msgs('a'));
    cache.get(msgs('b'));
    // stats should all be 0
    assert.strictEqual(0, cache.stats.hits);
    assert.strictEqual(0, cache.stats.misses);
  });
});
