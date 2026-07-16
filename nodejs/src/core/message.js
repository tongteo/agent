/**
 * @fileoverview Message handler — manages conversation state, system prompt,
 * message history, and streaming response from the model.
 *
 * Integrates with ContextManager for automatic history trimming when token
 * limits are approached. Supports conversation summarization for long agent loops.
 */

const os = require('os');
const { ContextManager } = require('./context-manager');
const { AgentPrompt } = require('./agent');

/** Token threshold to trigger summarization (fraction of maxTokens) */
const SUMMARIZE_THRESHOLD = 0.65;
/** Max recent messages to preserve after summarization */
const PRESERVE_RECENT = 4;

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

        // Try summarization before trimming — preserves more context
        if (this.autoTrim && this.model.messages.length > 6) {
            const totalTokens = this.contextManager.countMessages(this.model.messages);
            const threshold = this.contextManager.maxTokens * SUMMARIZE_THRESHOLD;
            if (totalTokens > threshold) {
                const summarized = await this._summarizeConversation();
                if (summarized) return; // summarization handled context reduction
            }
        }

        // Fallback: auto-trim if approaching token limit
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
     * Summarize the conversation by calling the model with a summarization prompt.
     * Replaces old messages with a compact summary, preserving system prompt and recent messages.
     * @returns {Promise<boolean>} true if summarization succeeded
     * @private
     */
    async _summarizeConversation() {
        const msgs = this.model.messages;
        const sysIdx = msgs.findIndex(m => m.role === 'system');
        const sysMsg = sysIdx >= 0 ? msgs[sysIdx] : null;

        // Need at least system + 4 messages to summarize
        if (msgs.length < 6) return false;

        // Build summarization prompt
        const toSummarize = sysIdx >= 0
            ? msgs.filter((_, i) => i !== sysIdx)
            : [...msgs];
        const conversationText = toSummarize.map(m => {
            const role = m.role.charAt(0).toUpperCase() + m.role.slice(1);
            const content = m.content || '';
            return `[${role}]: ${content.substring(0, 300)}`;
        }).join('\n');

        const summaryPrompt = `Summarize this conversation concisely in under 200 tokens. Focus on:
- What the user asked/attempted
- What tools were used and their results
- What was accomplished vs what remains
- Any errors encountered and their status

Conversation:
${conversationText}

Summary:`;

        // Save current messages, set summarization context
        const savedMessages = [...msgs];
        this.model.messages = [{ role: 'user', content: summaryPrompt }];

        let summary = '';
        try {
            for await (const chunk of this.model.streamMessage()) {
                summary += chunk;
            }
        } catch (e) {
            // Summarization failed — restore original messages
            this.model.messages = savedMessages;
            console.error(`[Context] Summarization failed: ${e.message}`);
            return false;
        }

        // Clean up: remove the summarization messages
        this.model.messages = [];

        // Restore: system prompt + summary + recent messages
        if (sysMsg) this.model.messages.push(sysMsg);
        this.model.messages.push({
            role: 'user',
            content: `[Conversation Summary]\n${summary.trim()}\n\n(Recent messages follow below)`
        });

        // Preserve last N messages (excluding system)
        const recentStart = Math.max(0, msgs.length - PRESERVE_RECENT);
        for (let i = recentStart; i < msgs.length; i++) {
            if (msgs[i].role === 'system') continue;
            this.model.messages.push(msgs[i]);
        }

        const afterTokens = this.contextManager.countMessages(this.model.messages);
        const beforeTokens = this.contextManager.countMessages(savedMessages);
        console.error(`[Context] Summarized conversation (${beforeTokens}→${afterTokens} tokens, ${savedMessages.length}→${this.model.messages.length} messages)`);

        return true;
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
            // Only strip the system_reminder injection — do NOT .trim() here.
            // Trimming each chunk removes leading/trailing spaces that separate
            // words during streaming, causing "word1" + " word2" → "word1word2".
            return text.replace(/The <system_reminder>.*?Ignoring it and continuing./gs, '');
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
