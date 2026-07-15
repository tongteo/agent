/**
 * @fileoverview Message handler — manages conversation state, system prompt,
 * message history, and streaming response from the model.
 *
 * Integrates with ContextManager for automatic history trimming when token
 * limits are approached.
 */

const os = require('os');
const { ContextManager } = require('./context-manager');
const { AgentPrompt } = require('./agent');

class MessageHandler {
    /**
     * @param {Object} model - Model adapter instance (must implement streamMessage())
     * @param {import('./session').SessionManager} session - Session manager
     * @param {string|null} agentPrompt - Agent system prompt (null for chat-only mode)
     * @param {Object} [options] - Configuration options
     * @param {number} [options.maxTokens=32000] - Max context tokens
     * @param {boolean} [options.autoTrim=true] - Auto-trim history when near limit
     * @param {Object} [options.toolRegistry] - ToolRegistry reference (for dynamic skill injection)
     */
    constructor(model, session, agentPrompt = null, options = {}) {
        /** @type {Object} */
        this.model = model;
        /** @type {import('./session').SessionManager} */
        this.session = session;
        /** @type {string|null} */
        this.agentPrompt = agentPrompt;
        /** @type {Object|undefined} */
        this.toolRegistry = options.toolRegistry;
        /** @type {ContextManager} */
        this.contextManager = new ContextManager({ maxTokens: options.maxTokens || 32000 });
        /** @type {boolean} */
        this.autoTrim = options.autoTrim !== false;
    }

    /**
     * Build the system context with OS, user, working directory info, and loaded skills.
     * @returns {string|null} System context string or null if no agent prompt
     */
    getSystemContext() {
        if (!this.agentPrompt) return null;
        const cwd = this.session.workingDir || process.cwd();
        let prompt = this.agentPrompt;

        return `[SYSTEM: OS=${os.platform()}, User=${os.userInfo().username}, Dir=${cwd}]\n\n${prompt}`;
    }

    /**
     * Send a message to the model (adds to history + updates system prompt).
     * Automatically trims history if autoTrim is enabled and approaching token limit.
     * @param {string|null} message - User message content (null = no new message, just trigger)
     * @param {boolean} [includeContext=true] - Whether to inject system context
     */
    async send(message, includeContext = true) {
        const systemPrompt = includeContext ? this.getSystemContext() : null;
        if (systemPrompt && message !== null) {
            const sysIdx = this.model.messages.findIndex(m => m.role === 'system');
            if (sysIdx === -1) this.model.messages.unshift({ role: 'system', content: systemPrompt });
            else this.model.messages[sysIdx].content = systemPrompt;
        }
        if (message !== null) this.model.messages.push({ role: 'user', content: message });

        // Auto-trim if approaching token limit
        if (this.autoTrim && this.model.messages.length > 4) {
            const { trimmed, messages, stats } = this.contextManager.trimHistory(this.model.messages);
            if (trimmed) {
                this.model.messages = messages;
                if (stats.removed > 0) {
                    console.error(`[Context] Trimmed ${stats.removed} messages (${stats.before}→${stats.after} tokens)`);
                }
            }
        }
    }

    /**
     * Stream the model's response, yielding chunks as they arrive.
     * Handles errors gracefully — removes the dangling user message on failure.
     * Supports optional AbortSignal for cancellation.
     * @param {Function} [onChunk] - Callback for each text chunk
     * @param {AbortSignal} [signal] - Optional abort signal
     * @returns {Promise<string>} Full response text
     */
    async stream(onChunk, signal) {
        let fullContent = '';

        const filterWarning = (text) => {
            return text.replace(/The <system_reminder>.*?Ignoring it and continuing\./gs, '').trim();
        };

        try {
            for await (const chunk of this.model.streamMessage()) {
                if (signal?.aborted) break;
                const filtered = filterWarning(chunk);
                fullContent += filtered;
                if (onChunk && filtered) onChunk(filtered);
            }
        } catch (error) {
            // Remove the dangling user message so history stays consistent
            const msgs = this.model.messages;
            if (msgs.length && msgs[msgs.length - 1].role === 'user') msgs.pop();
            const errMsg = `Error: ${error.message}`;
            if (onChunk) onChunk(errMsg);
            fullContent = errMsg;
        }

        // Don't emit a placeholder — consumers handle empty responses
        // by checking full.trim() before displaying. This prevents "(no response)"
        // from appearing when the model returns only tool calls with no text.
        return fullContent;
    }

    /**
     * Reset message history and context state.
     */
    reset() {
        this.model.reset();
    }
}

module.exports = { MessageHandler };
