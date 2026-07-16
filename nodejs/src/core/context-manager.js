/**
 * @fileoverview Context Window Manager — token counting and history trimming.
 *
 * Prevents token limit overflow in long conversations by estimating token counts
 * and trimming old messages when approaching the limit.
 *
 * Uses a simple heuristic: ~4 characters per token for most languages,
 * with CJK character weighting (each CJK char ≈ 2 tokens).
 */

const CJK_RE = /[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff]/g;

class ContextManager {
    /**
     * @param {Object} [options] - Configuration options
     * @param {number} [options.maxTokens=1000000] - Maximum token limit
     * @param {number} [options.warningThreshold=0.75] - Fraction of maxTokens to trigger trimming
     * @param {number} [options.trimTarget=0.5] - Target fraction to trim down to
     * @param {number} [options.reserveTokens=1000] - Reserved tokens for system prompt + tool results
     */
    constructor(options = {}) {
        this.maxTokens = options.maxTokens || 1000000;
        this.warningThreshold = options.warningThreshold || 0.75;
        this.trimTarget = options.trimTarget || 0.5;
        this.reserveTokens = options.reserveTokens || 1000;
        /** @type {Map<string, number>} LRU-ish cache for token estimates */
        this._tokenCache = new Map();
        this._cacheMax = 500;
    }

    /**
     * Estimate the number of tokens in a text string.
     * Uses ~4 chars/token for ASCII, ~1 char/token for CJK.
     * Results are cached to avoid repeated regex scans of the same text.
     * @param {string} text - Text to estimate
     * @returns {number} Estimated token count
     */
    estimateTokens(text) {
        if (!text) return 0;
        // Cache hit
        const cached = this._tokenCache.get(text);
        if (cached !== undefined) return cached;
        // Compute
        const cjkCount = (text.match(CJK_RE) || []).length;
        const asciiCount = text.length - cjkCount;
        const result = Math.ceil(cjkCount * 1.5 + asciiCount / 4);
        // Cache with LRU eviction
        if (this._tokenCache.size >= this._cacheMax) {
            const firstKey = this._tokenCache.keys().next().value;
            this._tokenCache.delete(firstKey);
        }
        this._tokenCache.set(text, result);
        return result;
    }

    /** Clear the token estimation cache (call after trimming). */
    _clearCache() {
        this._tokenCache.clear();
    }

    /**
     * Count total tokens in a message array.
     * @param {Array<{role: string, content: string}>} messages - Message history
     * @returns {number} Total estimated token count
     */
    countMessages(messages) {
        if (!messages || !messages.length) return 0;
        let total = 0;
        for (const msg of messages) {
            total += this.estimateTokens(msg.content || '');
            total += 4; // Role overhead
        }
        return total;
    }

    /**
     * Batch-estimate tokens for an array of messages, returning parallel arrays.
     * Minimizes cache overhead by computing in one pass.
     * @param {Array<{role: string, content: string}>} messages
     * @returns {{ totals: number[], perMessage: number[], grandTotal: number }}
     */
    _countMessagesBatch(messages) {
        if (!messages || !messages.length) {
            return { totals: [], perMessage: [], grandTotal: 0 };
        }
        const perMessage = [];
        let grandTotal = 0;
        for (const msg of messages) {
            const t = this.estimateTokens(msg.content || '') + 4;
            perMessage.push(t);
            grandTotal += t;
        }
        return { perMessage, grandTotal };
    }

    /**
     * Check if history needs trimming and returns trimmed messages if needed.
     * Preserves the system prompt, recent messages, and the last user message.
     * Uses batch counting to reduce overhead.
     * @param {Array<{role: string, content: string}>} messages - Message history
     * @param {Object} [options] - Override options
     * @returns {{ trimmed: boolean, messages: Array, stats: { before: number, after: number } }}
     */
    trimHistory(messages, options = {}) {
        const maxTokens = options.maxTokens || this.maxTokens;
        const threshold = options.warningThreshold || this.warningThreshold;
        const trimTarget = options.trimTarget || this.trimTarget;

        if (!messages || messages.length <= 2) {
            return { trimmed: false, messages, stats: { before: 0, after: 0 } };
        }

        // Single batch count — one pass over all messages
        const { perMessage: msgTokens, grandTotal: totalTokens } = this._countMessagesBatch(messages);
        const warningLimit = maxTokens * threshold;

        if (totalTokens <= warningLimit) {
            return { trimmed: false, messages, stats: { before: totalTokens, after: totalTokens } };
        }

        // Need to trim: keep system prompt, last N messages
        const targetTokens = maxTokens * trimTarget;

        // Find system message index
        let sysIdx = -1;
        for (let i = 0; i < messages.length; i++) {
            if (messages[i].role === 'system') { sysIdx = i; break; }
        }

        // Build trimmed list from the end, using precomputed token counts
        let runningTokens = sysIdx >= 0 ? msgTokens[sysIdx] : 0;
        const trimmed = sysIdx >= 0 ? [messages[sysIdx]] : [];

        for (let i = messages.length - 1; i >= 0; i--) {
            if (i === sysIdx) continue;
            const t = msgTokens[i];
            if (runningTokens + t > targetTokens - this.reserveTokens && trimmed.length > (sysIdx >= 0 ? 1 : 0)) {
                break;
            }
            trimmed.splice(sysIdx >= 0 ? 1 : 0, 0, messages[i]);
            runningTokens += t;
        }

        const afterTokens = runningTokens;

        // Clear cache after trimming since message content may have changed
        this._clearCache();

        return {
            trimmed: trimmed.length < messages.length,
            messages: trimmed,
            stats: {
                before: totalTokens,
                after: afterTokens,
                removed: messages.length - trimmed.length
            }
        };
    }

    /**
     * Truncate a single message or tool result to fit within token budget.
     * @param {string} text - Text to truncate
     * @param {number} [maxTokens=2000] - Maximum tokens allowed
     * @returns {string} Truncated text
     */
    truncate(text, maxTokens = 2000) {
        if (!text) return text;
        const estimated = this.estimateTokens(text);
        if (estimated <= maxTokens) return text;

        const ratio = maxTokens / estimated;
        const truncateLen = Math.floor(text.length * ratio);
        return text.slice(0, truncateLen) + `\n...(truncated, ${estimated - maxTokens} tokens removed)`;
    }

    /**
     * Get a human-readable summary of context stats.
     * @param {Array<{role: string, content: string}>} messages - Message history
     * @returns {string} Stats string
     */
    getStats(messages) {
        const total = this.countMessages(messages);
        const pct = Math.round((total / this.maxTokens) * 100);
        const byRole = {};
        for (const msg of messages) {
            byRole[msg.role] = (byRole[msg.role] || 0) + this.estimateTokens(msg.content || '');
        }
        const details = Object.entries(byRole)
            .map(([role, tokens]) => `${role}=${tokens}t`)
            .join(', ');
        return `Context: ${total}/${this.maxTokens} tokens (${pct}%) — ${details}`;
    }
}

module.exports = { ContextManager };
