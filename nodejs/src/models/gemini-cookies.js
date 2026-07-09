/**
 * @fileoverview Gemini Cookies Adapter — wraps GeminiClient as a model adapter.
 * Implements the adapter interface expected by MessageHandler.
 */

const { GeminiClient } = require('../bridges/gemini-client');

class GeminiCookiesAdapter {
  constructor() {
    /** @type {string} */
    this.model = 'gemini-web';
    /** @type {Array<{role: string, content: string}>} */
    this.messages = [];
    /** @type {Object|null} */
    this.lastUsage = null;
    /** @type {GeminiClient|null} */
    this._client = null;
    /** @type {boolean} */
    this._sentSystem = false;
  }

  /**
   * Initialize the adapter and its underlying Gemini client.
   * @returns {Promise<void>}
   */
  async init() {
    this._client = new GeminiClient();
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

  /** Clean up page state after a full turn (between user messages). */
  async _cleanInterturn() {
    if (this._client) {
      try { await this._client.reset(); } catch { /* ignore */ }
    }
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

module.exports = { GeminiCookiesAdapter };
