/**
 * @fileoverview Claude Cookies Adapter — wraps ClaudeClient as a model adapter.
 * Implements the adapter interface expected by MessageHandler.
 */

const { ClaudeClient } = require('../bridges/claude-client');

class ClaudeCookiesAdapter {
  constructor() {
    /** @type {string} */
    this.model = 'claude-web';
    /** @type {Array<{role: string, content: string}>} */
    this.messages = [];
    /** @type {Object|null} */
    this.lastUsage = null;
    /** @type {ClaudeClient|null} */
    this._client = null;
    /** @type {boolean} */
    this._sentSystem = false;
  }

  /**
   * Initialize the adapter and its underlying Claude client.
   * @returns {Promise<void>}
   */
  async init() {
    this._client = new ClaudeClient();
    await this._client.init();
  }

  /**
   * Stream the model's response for the last user message.
   * @yields {string} Response text chunks
   */
  async *streamMessage() {
    const userMsg = this.messages.at(-1);
    if (!userMsg) return;

    const systemMsg = this.messages.find(m => m.role === 'system');
    let text = userMsg.content;

    if (systemMsg && !this._sentSystem) {
      text = `${systemMsg.content}\n\n${text}`;
      this._sentSystem = true;
    }

    await this._client.sendMessage(text);
    const response = await this._client.waitForResponse();

    this.messages.push({ role: 'assistant', content: response });
    yield response;
  }

  /** Reset conversation history. */
  reset() {
    this.messages = [];
    this._sentSystem = false;
    if (this._client) {
      this._client.reset().catch(() => {});
    }
  }

  /** Clean up resources. */
  cleanup() {
    if (this._client) {
      this._client.cleanup().catch(() => {});
      this._client = null;
    }
  }
}

module.exports = { ClaudeCookiesAdapter };
