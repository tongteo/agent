/**
 * @fileoverview Subagent Manager — spawns parallel sub-agent conversations for task delegation.
 */

class SubagentManager {
    /**
     * @param {string} apiKey - API key for model access
     * @param {string} model - Model identifier
     * @param {string} rootPath - Working directory for subagents
     */
    constructor(apiKey, model, rootPath) {
        /** @type {string} */
        this.apiKey = apiKey;
        /** @type {string} */
        this.model = model;
        /** @type {string} */
        this.rootPath = rootPath;
        /** @type {Map<string, import('../chat-bot').ChatBot>} */
        this.activeSubagents = new Map();
    }

    /**
     * Invoke multiple subagents in parallel.
     * @param {Array<{query?: string, task?: string, agent_name?: string, relevant_context?: string}>} subagents
     * @returns {Promise<Array<Object>>} Array of subagent results
     */
    async invokeSubagents(subagents) {
        const results = await Promise.all(
            subagents.map((config, index) => this.runSubagent(config, index))
        );
        return results;
    }

    /**
     * Run a single subagent with the given configuration.
     * @param {Object} config - Subagent config
     * @param {string} [config.query] - Task query
     * @param {string} [config.task] - Alternative task field
     * @param {string} [config.agent_name] - Agent name for identification
     * @param {string} [config.relevant_context] - Additional context
     * @param {number} index - Subagent index
     * @returns {Promise<Object>} Result object with subagent_id, response, success status
     */
    async runSubagent(config, index) {
        const { query, task, agent_name, relevant_context } = config;
        const subagentId = `subagent_${index}_${Date.now()}`;

        try {
            // Lazy load to avoid circular dependency
            const { ChatBot } = require('../chat-bot');
            const bot = new ChatBot(this.apiKey, this.model, true, false);
            await bot.init();
            bot.session.workingDir = this.rootPath;

            this.activeSubagents.set(subagentId, bot);

            let fullQuery = query || task || '';
            if (!fullQuery) {
                throw new Error('Missing query or task field');
            }
            if (relevant_context) {
                fullQuery = `Context: ${relevant_context}\n\nTask: ${fullQuery}`;
            }

            let response = '';
            let taskError = null;

            try {
                response = await bot.chatOnce(fullQuery);
            } catch (err) {
                taskError = err;
                response = err.message || 'Subagent execution failed';
            }

            this.activeSubagents.delete(subagentId);

            return {
                subagent_id: subagentId,
                agent_name: agent_name || 'default',
                query: query || task,
                response,
                success: !taskError || response.length > 0,
                ...(taskError && { warning: taskError.message })
            };
        } catch (error) {
            this.activeSubagents.delete(subagentId);
            return {
                subagent_id: subagentId,
                agent_name: agent_name || 'default',
                query: query || task || '',
                error: error.message,
                success: false
            };
        }
    }

    /**
     * List available agent types.
     * @returns {Array<{name: string, description: string, capabilities: string[]}>}
     */
    listAgents() {
        return [
            {
                name: 'default',
                description: 'General purpose agent with all tools',
                capabilities: ['file_ops', 'code_intelligence', 'command_execution', 'search']
            }
        ];
    }

    /** Clean up all active subagents. */
    cleanup() {
        for (const [id, bot] of this.activeSubagents) {
            bot.cleanup?.();
        }
        this.activeSubagents.clear();
    }
}

module.exports = { SubagentManager };
