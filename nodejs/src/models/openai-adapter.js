/**
 * @fileoverview OpenAI-compatible Streaming Adapter
 *
 * Connects to any OpenAI-compatible API endpoint (OmniRoute, OpenRouter,
 * local vLLM, Ollama, etc.) via /v1/chat/completions with SSE streaming.
 *
 * Supports: streaming, function calling (tools), usage tracking.
 *
 * Env vars:
 *   OPENAI_API_KEY   — API key (required)
 *   OPENAI_BASE_URL  — Base URL, defaults to https://api.openai.com/v1
 *   OPENAI_MODEL     — Model name, defaults to gpt-4o-mini
 */

const fetch = require('node-fetch');

class OpenAIAdapter {
  /**
   * @param {Object} [opts]
   * @param {string} [opts.apiKey]      — override OPENAI_API_KEY
   * @param {string} [opts.baseUrl]     — override OPENAI_BASE_URL
   * @param {string} [opts.model]       — override OPENAI_MODEL
   * @param {number} [opts.maxTokens]   — max completion tokens (default 16384)
   * @param {boolean} [opts.tools]      — enable function calling (default false)
   * @param {Object[]} [opts.toolSchemas] — OpenAI tool schema array
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

    if (!this.apiKey) {
      throw new Error('No API key. Set OPENAI_API_KEY in .env or pass apiKey option.');
    }
  }

  async init() {
    // Verify connectivity (lightweight models listing check)
    try {
      const res = await fetch(`${this.baseUrl}/models`, {
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
          process.stderr.write(`  ✓ Connected to ${this.baseUrl}\n`);
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
   * Build the request body for /v1/chat/completions.
   * @returns {Object}
   */
  _buildRequestBody() {
    const body = {
      model: this.model,
      messages: this.messages,
      max_tokens: this.maxTokens,
      stream: true,
    };

    if (this._toolsEnabled && this._toolSchemas?.length) {
      body.tools = this._toolSchemas;
      body.tool_choice = 'auto';
    }

    return body;
  }

  /**
   * Stream the model's response for the last messages.
   * Async generator yielding text chunks.
   *
   * Handles:
   * - Regular text content chunks
   * - Function call chunks (collected into this.pendingToolCalls)
   * - Usage tracking in this.lastUsage
   *
   * @yields {string} Response text chunks
   */
  async *streamMessage() {
    const body = this._buildRequestBody();
    this._abortController = new AbortController();

    let res;
    try {
      res = await fetch(`${this.baseUrl}/chat/completions`, {
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
      throw new Error(`API request failed: ${e.message}`);
    }

    if (!res.ok) {
      const errText = await res.text().catch(() => 'unknown error');
      throw new Error(`API error ${res.status}: ${errText.slice(0, 500)}`);
    }

    // Parse SSE stream
    const reader = res.body;
    let buffer = '';
    let fullText = '';
    // Accumulate tool call deltas
    const toolCallMap = new Map(); // index -> {id, name, arguments}

    for await (const chunk of reader) {
      buffer += chunk.toString();

      // Process complete SSE lines
      while (buffer.includes('\n')) {
        const nlIdx = buffer.indexOf('\n');
        const line = buffer.slice(0, nlIdx).replace(/\r$/, '');
        buffer = buffer.slice(nlIdx + 1);

        if (line.startsWith('data: ')) {
          const data = line.slice(6);
          if (data === '[DONE]') break;

          let parsed;
          try { parsed = JSON.parse(data); } catch { continue; }

          // Usage from final chunk
          if (parsed.usage) {
            this.lastUsage = parsed.usage;
          }

          const delta = parsed.choices?.[0]?.delta;
          if (!delta) continue;

          // Text content
          if (delta.content) {
            fullText += delta.content;
            yield delta.content;
          }

          // Function/tool calls (streaming deltas)
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

          // Finish reason — check for tool calls
          const finishReason = parsed.choices?.[0]?.finish_reason;
          if (finishReason === 'tool_calls' || finishReason === 'stop') {
            // Tool calls are finalized below after stream ends
          }
        }
      }
    }

    // Append assistant response to history
    const assistantMsg = { role: 'assistant', content: fullText || null };

    // If tool calls were collected, attach them
    if (toolCallMap.size > 0) {
      assistantMsg.tool_calls = Array.from(toolCallMap.values()).map(tc => ({
        id: tc.id,
        type: 'function',
        function: { name: tc.name, arguments: tc.arguments },
      }));

      // Set pendingToolCalls so chat-bot.js can process them
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

  /** Reset conversation history. */
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
}

module.exports = { OpenAIAdapter };
