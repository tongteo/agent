/**
 * @fileoverview KV Cache with exact-match keys, LRU eviction,
 * hash-based keys, periodic cleanup of expired entries, and hit/miss metrics.
 *
 * Cache key: MD5 hash of messages skeleton (truncated content for stability)
 * → short, collision-resistant. Exact-match only — no prefix fallback
 * to avoid stale hits in agent mode where tool results change context.
 */

const crypto = require('crypto');

/** @typedef {{ value: string, ts: number, hits: number }} CacheEntry */

class KVCache {
    /**
     * @param {Object} [opts]
     * @param {number} [opts.maxSize=100]        — Max cache entries
     * @param {number} [opts.ttlMs=1800000]      — Time-to-live in ms (default 30 min)
     * @param {number} [opts.cleanupInterval=50]  — Prune expired every N set() calls
     * @param {boolean} [opts.metrics=true]       — Track hit/miss stats
     */
    constructor(opts = {}) {
        if (typeof opts === 'number') {
            opts = { maxSize: opts, ttlMs: arguments[1] };
        }
        /** @type {Map<string, CacheEntry>} */
        this.cache = new Map();
        this.maxSize = opts.maxSize || 100;
        this.ttlMs = opts.ttlMs || 30 * 60 * 1000;
        this.cleanupInterval = opts.cleanupInterval || 50;

        // Metrics
        this._metricsEnabled = opts.metrics !== false;
        /** @type {{ hits: number, misses: number, evictions: number, sets: number, expired: number }} */
        this.stats = { hits: 0, misses: 0, evictions: 0, sets: 0, expired: 0 };
        this._setCount = 0;
    }

    /**
     * Build a "skeleton" of messages for cache keying.
     * Truncates long content so similar conversations produce the same key.
     * @param {Array<{role: string, content: string}>} messages
     * @returns {Object[]}
     * @private
     */
    _skeleton(messages) {
        return messages.map(m => {
            const role = m.role;
            const content = m.content || '';
            if (role === 'system') {
                return { r: 's', c: content.substring(0, 200) };
            }
            if (role === 'user') {
                return { r: 'u', c: content.substring(0, 500) };
            }
            if (role === 'assistant') {
                if (m.tool_calls) {
                    return { r: 'a', tc: m.tool_calls.map(t => t.function?.name || t.name).sort().join(',') };
                }
                return { r: 'a', c: content.substring(0, 150) };
            }
            if (role === 'tool') {
                return { r: 't', n: m.name, c: content.substring(0, 80) };
            }
            return { r: role, c: content.substring(0, 80) };
        });
    }

    /**
     * Generate a deterministic cache key from messages.
     * @param {Array} messages
     * @returns {string}
     * @private
     */
    _key(messages) {
        const raw = JSON.stringify(this._skeleton(messages));
        return crypto.createHash('md5').update(raw).digest('hex');
    }

    /**
     * Get cached response. Exact-match only.
     * Promotes to most-recently-used (true LRU).
     * @param {Array<{role: string, content: string}>} messages
     * @returns {string|null} Cached value or null
     */
    get(messages) {
        const key = this._key(messages);
        const entry = this.cache.get(key);
        if (!entry) {
            if (this._metricsEnabled) this.stats.misses++;
            return null;
        }
        // TTL check
        if (Date.now() - entry.ts > this.ttlMs) {
            this.cache.delete(key);
            if (this._metricsEnabled) {
                this.stats.misses++;
                this.stats.expired++;
            }
            return null;
        }
        // LRU: delete + re-insert moves to end (most-recently-used)
        this.cache.delete(key);
        entry.hits++;
        this.cache.set(key, entry);
        if (this._metricsEnabled) this.stats.hits++;
        return entry.value;
    }

    /**
     * Set cached response. Evicts LRU entry if at capacity.
     * Prunes expired entries periodically.
     * @param {Array<{role: string, content: string}>} messages
     * @param {string} value — Response to cache
     */
    set(messages, value) {
        const key = this._key(messages);

        // If key already exists, update in place (don't count as new set)
        if (this.cache.has(key)) {
            this.cache.delete(key);
        } else {
            // New entry — evict LRU if at capacity
            if (this.cache.size >= this.maxSize) {
                this.cache.delete(this.cache.keys().next().value);
                if (this._metricsEnabled) this.stats.evictions++;
            }
        }

        this.cache.set(key, { value, ts: Date.now(), hits: 0 });
        if (this._metricsEnabled) this.stats.sets++;

        // Periodic expired-entry cleanup
        this._setCount++;
        if (this._setCount >= this.cleanupInterval) {
            this._setCount = 0;
            this._prune();
        }
    }

    /**
     * Remove all expired entries from the cache.
     * @private
     */
    _prune() {
        const now = Date.now();
        for (const [key, entry] of this.cache) {
            if (now - entry.ts > this.ttlMs) {
                this.cache.delete(key);
                if (this._metricsEnabled) this.stats.expired++;
            }
        }
    }

    /** Clear all cache entries and reset metrics. */
    clear() {
        this.cache.clear();
        if (this._metricsEnabled) {
            this.stats = { hits: 0, misses: 0, evictions: 0, sets: 0, expired: 0 };
        }
        this._setCount = 0;
    }

    /** @returns {number} Current cache size */
    get size() {
        return this.cache.size;
    }

    /**
     * Get cache metrics summary.
     * @returns {{ hits: number, misses: number, hitRate: string, evictions: number, sets: number, expired: number, size: number }}
     */
    getMetrics() {
        const total = this.stats.hits + this.stats.misses;
        return {
            ...this.stats,
            size: this.cache.size,
            hitRate: total > 0 ? `${((this.stats.hits / total) * 100).toFixed(1)}%` : 'N/A',
            totalRequests: total,
        };
    }

    /**
     * Human-readable stats string.
     * @returns {string}
     */
    statsString() {
        const m = this.getMetrics();
        return `KVCache: ${m.size}/${this.maxSize} entries | hits=${m.hits} misses=${m.misses} rate=${m.hitRate} | evictions=${m.evictions} expired=${m.expired}`;
    }
}

module.exports = { KVCache };
