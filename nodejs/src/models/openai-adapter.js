/**
 * @fileoverview OpenAI-compatible Streaming Adapter
 *
 * Connects to any OpenAI-compatible API endpoint (OmniRoute, OpenRouter,
 * local vLLM, Ollama, etc.) via /v1/chat/completions with SSE streaming.
 *
 * Supports: streaming, function calling (tools), usage tracking,
 * response-level KV caching, and API-level prompt caching markers.
 *
 * Env vars:
 *   OPENAI_API_KEY   — API key (required)
 *   OPENAI_BASE_URL  — Base URL, defaults to https://api.openai.com/v1
 *   OPENAI_MODEL     — Model name, defaults to gpt-4o-mini
 */

const _fetch = require('node-fetch');
const { KVCache } = require('../core/kv-cache');

/** Transient network errors worth retrying. */
const TRANSIENT_ERRORS = new Set([
  'ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EPIPE', 'ENOTFOUND',
  'socket hang up', 'aborted', 'network error', 'fetch failed',
]);

/**
 * @param {Error} e
 * @returns {boolean}
 */
function _isTransient(e) {
  const msg = (e.message || '').toLowerCase();
  if (TRANSIENT_ERRORS.has(e.code) || TRANSIENT_ERRORS.has(e.type)) return true;
  for (const term of TRANSIENT_ERRORS) {
    if (msg.includes(term.toLowerCase())) return true;
  }
  return false;
}

/**
 * @param {import('http').IncomingMessage} res
 * @returns {boolean} HTTP status is a transient server error
 */
function _isRetryableStatus(res) {
  return res.status === 429 || res.status >= 500;
}

class OpenAIAdapter {
  /**
   * @param {Object} [opts]
   * @param {string} [opts.apiKey]              — override OPENAI_API_KEY
   * @param {string} [opts.baseUrl]             — override OPENAI_BASE_URL
   * @param {string} [opts.model]               — override OPENAI_MODEL
   * @param {number} [opts.maxTokens]           — max completion tokens (default 16384)
   * @param {boolean} [opts.tools]              — enable function calling (default false)
   * @param {Object[]} [opts.toolSchemas]       — OpenAI tool schema array
   * @param {boolean} [opts.cacheEnabled]       — enable response-level KV cache (default true)
   * @param {number}  [opts.cacheMaxSize]       — max cached responses (default 100)
   * @param {number}  [opts.cacheTtlMs]         — cache TTL in ms (default 30 min)
   * @param {boolean} [opts.promptCacheControl] — add cache_control markers for Anthropic (default false)
   * @param {number}  [opts.maxRetries]         — max retries for transient errors (default 3)
   */
  constructor(opts = {}) {
    this.apiKey  = opts.apiKey  || process.env.OPENAI_API_KEY  || '';
    this.baseUrl = (opts.baseUrl || process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '');
    this.model   = opts.model   || process.env.OPENAI_MODEL     || 'gpt-4o-mini';
    this.maxTokens = opts.maxTokens || 16384;

    /** @type {Array<{role: string, content: string}>} */
    this.messages = [];
    /** @type {Object|null} */
    this.lastUsage = null;
    /** @type {Array|null} Pending native function calls from last response */
    this.pendingToolCalls = null;

    /** Whether to include tools in requests */
    this._toolsEnabled = !!opts.tools;
    /** @type {Object[]|null} OpenAI tool schemas */
    this._toolSchemas = opts.toolSchemas || null;
    /** Expose tools capability for chat-bot.js agent prompt selection */
    this.tools = this._toolsEnabled;

    /** AbortController for cancelling in-flight streams */
    this._abortController = null;

    /** Max retries for transient fetch errors */
    this._maxRetries = opts.maxRetries ?? 3;

    /** Injectable fetch for testing (defaults to node-fetch) */
    this._fetch = opts.fetch || _fetch;

    // ── Response-level KV cache ──
    this._cacheEnabled = opts.cacheEnabled !== false;
    /** @type {KVCache|null} */
    this._cache = this._cacheEnabled
      ? new KVCache({
          maxSize: opts.cacheMaxSize || 100,
          ttlMs: opts.cacheTtlMs || 30 * 60 * 1000,
        })
      : null;

    // ── API-level prompt caching (Anthropic cache_control markers) ──
    this._promptCacheControl = opts.promptCacheControl || false;

    if (!this.apiKey) {
      throw new Error('No API key. Set OPENAI_API_KEY in .env or pass apiKey option.');
    }
  }

  async init() {
    // Verify connectivity (lightweight models listing check)
    try {
      const res = await this._fetch(`${this.baseUrl}/models`, {
        headers: { 'Authorization': `Bearer ${this.apiKey}` },
        signal: AbortSignal.timeout(8000),
      });
      // Some providers don't support /models — that's OK
      if (res.ok) {
        const data = await res.json();
        // Log available model count if present
        const count = data?.data?.length;
        if (count) {
          process.stderr.write(`  ✓ Connected to ${this.baseUrl} (${count} models)\n`);
        } else {
          process.stderr.write(`  ✓ Using ${this.baseUrl}\n`);
        }
      } else {
        process.stderr.write(`  ✓ Using ${this.baseUrl} (status ${res.status})\n`);
      }
    } catch (e) {
      process.stderr.write(`  ⚠ Could not verify ${this.baseUrl}: ${e.message}\n`);
      // Don't fail — the endpoint might still work for completions
    }
  }

  /**
   * Enable tool/function calling with given schemas.
   * @param {Object[]} toolSchemas — OpenAI tool format: [{type:'function', function:{name,description,parameters}}]
   */
  enableTools(toolSchemas) {
    this._toolsEnabled = true;
    this._toolSchemas = toolSchemas;
    this.tools = true;
  }

  /**
   * Build messages array for the request, optionally adding cache_control markers.
   * @returns {Object[]} Messages with optional cache_control
   * @private
   */
  _buildMessages() {
    if (!this._promptCacheControl) return this.messages;

    // Add cache_control to system message and last tool messages
    // Anthropic: only first 4 breakpoints supported, so pick strategically
    return this.messages.map((msg, i) => {
      const enriched = { ...msg };
      // Mark system prompt (first message if it's system role)
      if (i === 0 && msg.role === 'system') {
        enriched.cache_control = { type: 'ephemeral' };
      }
      // Mark the last user message to cache everything up to it
      // (This caches system + all prior turns as a prefix)
      return enriched;
    });
  }

  /**
   * Build the request body for /v1/chat/completions.
   * @returns {Object}
   * @private
   */
  _buildRequestBody() {
    const body = {
      model: this.model,
      messages: this._buildMessages(),
      max_tokens: this.maxTokens,
      stream: true,
    };

    if (this._toolsEnabled && this._toolSchemas?.length) {
      // Add cache_control to tool definitions for Anthropic
      if (this._promptCacheControl) {
        body.tools = this._toolSchemas.map(t => ({
          ...t,
          cache_control: { type: 'ephemeral' },
        }));
      } else {
        body.tools = this._toolSchemas;
      }
      body.tool_choice = 'auto';
    }

    return body;
  }

  /**
   * Stream the model's response for the last messages.
   * Async generator yielding text chunks.
   *
   * On cache hit: yields cached text (no API call).
   * On cache miss: streams from API, caches non-tool-call responses.
   *
   * Handles:
   * - Regular text content chunks
   * - Function call chunks (collected into this.pendingToolCalls)
   * - Usage tracking in this.lastUsage
   *
   * @yields {string} Response text chunks
   */
  async *streamMessage() {
    // ── Check response cache ──
    if (this._cache) {
      const cached = this._cache.get(this.messages);
      if (cached !== null) {
        // Cache hit — yield the cached response without API call
        this.lastUsage = { prompt_tokens: 0, completion_tokens: 0, _cacheHit: true };
        yield cached;
        // Append assistant message to history (same as API path)
        this.messages.push({ role: 'assistant', content: cached });
        return;
      }
    }

    // ── Cache miss — stream from API (with retry) ──
    const body = this._buildRequestBody();
    let lastError;

    for (let attempt = 0; attempt <= this._maxRetries; attempt++) {
      // Reuse existing controller if already aborted (user called abort() before stream)
      if (this._abortController?.signal?.aborted) return;
      this._abortController = new AbortController();

      let res;
      try {
        res = await this._fetch(`${this.baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.apiKey}`,
          },
          body: JSON.stringify(body),
          signal: this._abortController.signal,
        });
      } catch (e) {
        if (e.name === 'AbortError') return; // cancelled
        lastError = e;
        if (_isTransient(e) && attempt < this._maxRetries) {
          const delay = 1000 * Math.pow(2, attempt);
          process.stderr.write(`  ⚠ ${e.message} — retrying in ${delay / 1000}s (${attempt + 1}/${this._maxRetries})\n`);
          await new Promise(r => setTimeout(r, delay));
          continue;
        }
        throw new Error(attempt > 0
          ? `API request failed after ${attempt} retries: ${e.message}`
          : `API request failed: ${e.message}`
        );
      }

      if (_isRetryableStatus(res) && attempt < this._maxRetries) {
        const delay = 1000 * Math.pow(2, attempt);
        const retryAfter = res.headers?.get?.('retry-after');
        const waitMs = retryAfter ? Math.min(parseInt(retryAfter, 10) * 1000, 30000) : delay;
        process.stderr.write(`  ⚠ API ${res.status} — retrying in ${waitMs / 1000}s (${attempt + 1}/${this._maxRetries})\n`);
        res.body?.resume?.(); // drain body to free socket
        await new Promise(r => setTimeout(r, waitMs));
        continue;
      }

      if (!res.ok) {
        const errText = await res.text().catch(() => 'unknown error');
        throw new Error(`API error ${res.status}: ${errText.slice(0, 500)}`);
      }

      // ── Stream SSE ──
      try {
        const result = yield* this._streamSSE(res);
        // Success — cache and return
        return;
      } catch (e) {
        if (e.name === 'AbortError') return;
        lastError = e;
        if (_isTransient(e) && attempt < this._maxRetries) {
          const delay = 1000 * Math.pow(2, attempt);
          process.stderr.write(`  ⚠ Stream interrupted: ${e.message} — retrying in ${delay / 1000}s (${attempt + 1}/${this._maxRetries})\n`);
          await new Promise(r => setTimeout(r, delay));
          continue;
        }
        throw e;
      }
    }
  }

  /**
   * Parse SSE stream from a response, yield text chunks, collect tool calls.
   * Caches pure text responses on completion.
   * @param {import('node-fetch').Response} res
   * @yields {string}
   * @private
   */
  async *_streamSSE(res) {
    const reader = res.body;
    let buffer = '';
    let fullText = '';
    const toolCallMap = new Map();
    let sawDataEvent = false;

    for await (const chunk of reader) {
      buffer += chunk.toString();

      while (buffer.includes('\n')) {
        const nlIdx = buffer.indexOf('\n');
        const line = buffer.slice(0, nlIdx).replace(/\r$/, '');
        buffer = buffer.slice(nlIdx + 1);

        if (line.startsWith('data: ')) {
          sawDataEvent = true;
          const data = line.slice(6);
          if (data === '[DONE]') break;

          let parsed;
          try { parsed = JSON.parse(data); } catch { continue; }

          if (parsed.usage) {
            this.lastUsage = parsed.usage;
          }

          const delta = parsed.choices?.[0]?.delta;
          if (!delta) continue;

          if (delta.content) {
            fullText += delta.content;
            yield delta.content;
          }

          if (delta.tool_calls && this._toolsEnabled) {
            for (const tc of delta.tool_calls) {
              const idx = tc.index ?? 0;
              if (!toolCallMap.has(idx)) {
                toolCallMap.set(idx, {
                  id: tc.id || '',
                  name: tc.function?.name || '',
                  arguments: '',
                });
              }
              const existing = toolCallMap.get(idx);
              if (tc.id) existing.id = tc.id;
              if (tc.function?.name) existing.name = tc.function.name;
              if (tc.function?.arguments) existing.arguments += tc.function.arguments;
            }
          }
        }
      }
    }

    // Detect non-SSE response body (e.g. JSON error wrapped in HTTP 200).
    // When the entire body is consumed and no SSE data events were found,
    // the body was likely a plain JSON error. Parse and surface it.
    if (!sawDataEvent) {
      const bodyText = (buffer || '').trim();
      if (bodyText) {
        let errPayload;
        try { errPayload = JSON.parse(bodyText); } catch {}
        if (errPayload?.error) {
          const errMsg = typeof errPayload.error === 'string'
            ? errPayload.error
            : errPayload.error.message || JSON.stringify(errPayload.error);
          throw new Error(`API error (non-SSE response): ${errMsg}`);
        }
      }
      throw new Error('Empty response from API — no SSE data received. Check model status.');
    }

    // Cache pure text responses
    if (this._cache && fullText && toolCallMap.size === 0) {
      this._cache.set(this.messages, fullText);
    }

    // Append assistant response to history
    const assistantMsg = { role: 'assistant', content: fullText || null };

    if (toolCallMap.size > 0) {
      assistantMsg.tool_calls = Array.from(toolCallMap.values()).map(tc => ({
        id: tc.id,
        type: 'function',
        function: { name: tc.name, arguments: tc.arguments },
      }));
      this.pendingToolCalls = assistantMsg.tool_calls.map(tc => ({
        id: tc.id,
        name: tc.function.name,
        arguments: tc.function.arguments,
      }));
    }

    this.messages.push(assistantMsg);
  }

  /** Abort an in-flight stream. */
  abort() {
    this._abortController?.abort();
  }

  /** Reset conversation history and clear cache. */
  reset() {
    this.messages = [];
    this.lastUsage = null;
    this.pendingToolCalls = null;
  }

  /** Clean up resources. */
  cleanup() {
    this._abortController?.abort();
    this._abortController = null;
  }

  // ── Cache API ──

  /** @returns {Object|null} Cache metrics, or null if cache disabled */
  getCacheStats() {
    return this._cache ? this._cache.getMetrics() : null;
  }

  /** @returns {string} Human-readable cache stats */
  getCacheStatsString() {
    return this._cache ? this._cache.statsString() : 'KVCache: disabled';
  }

  /** Clear the response cache. */
  clearCache() {
    this._cache?.clear();
  }
}

module.exports = { OpenAIAdapter };
