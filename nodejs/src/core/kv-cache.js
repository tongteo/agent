/**
 * @fileoverview KV Cache with TTL and LRU eviction.
 * Reduces redundant model requests for identical queries.
 */

class KVCache {
    /**
     * @param {number} [maxSize=100] - Maximum cache entries
     * @param {number} [ttlMs=1800000] - Time-to-live in ms (default 30 min)
     */
    constructor(maxSize = 100, ttlMs = 30 * 60 * 1000) {
        /** @type {Map<string, { value: string, ts: number }>} */
        this.cache = new Map();
        /** @type {number} */
        this.maxSize = maxSize;
        /** @type {number} */
        this.ttlMs = ttlMs;
    }

    /**
     * Generate a cache key from the last message.
     * @param {Array<{role: string, content: string}>} messages - Message history
     * @returns {string} Cache key
     * @private
     */
    _key(messages) {
        const last = messages[messages.length - 1];
        return `${messages.length}:${last?.role}:${last?.content?.slice(0, 200)}`;
    }

    /**
     * Get cached response, or null if expired/missing.
     * @param {Array} messages - Message history
     * @returns {string|null} Cached value or null
     */
    get(messages) {
        const key = this._key(messages);
        const entry = this.cache.get(key);
        if (!entry) return null;
        if (Date.now() - entry.ts > this.ttlMs) {
            this.cache.delete(key);
            return null;
        }
        return entry.value;
    }

    /**
     * Set cached response. Evicts oldest entry if at capacity.
     * @param {Array} messages - Message history
     * @param {string} value - Response to cache
     */
    set(messages, value) {
        if (this.cache.size >= this.maxSize) {
            // Evict oldest (Map iteration order = insertion order)
            this.cache.delete(this.cache.keys().next().value);
        }
        this.cache.set(this._key(messages), { value, ts: Date.now() });
    }

    /** Clear all cache entries. */
    clear() {
        this.cache.clear();
    }

    /** @returns {number} Current cache size */
    get size() {
        return this.cache.size;
    }
}

module.exports = { KVCache };
