class KVCache {
    constructor(maxSize = 100, ttlMs = 30 * 60 * 1000) {
        this.cache = new Map();
        this.maxSize = maxSize;
        this.ttlMs = ttlMs;
    }

    _key(messages) {
        const last = messages[messages.length - 1];
        return `${messages.length}:${last?.role}:${last?.content?.slice(0, 200)}`;
    }

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

    set(messages, value) {
        if (this.cache.size >= this.maxSize) {
            // Evict oldest
            this.cache.delete(this.cache.keys().next().value);
        }
        this.cache.set(this._key(messages), { value, ts: Date.now() });
    }

    clear() {
        this.cache.clear();
    }

    get size() {
        return this.cache.size;
    }
}

module.exports = { KVCache };
