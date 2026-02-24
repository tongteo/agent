class SubagentManager {
    constructor(apiKey, model, rootPath) {
        this.apiKey = apiKey;
        this.model = model;
        this.rootPath = rootPath;
        this.activeSubagents = new Map();
    }

    async invokeSubagents(subagents) {
        const results = await Promise.all(
            subagents.map((config, index) => this.runSubagent(config, index))
        );
        return results;
    }

    async runSubagent(config, index) {
        const { query, agent_name, relevant_context } = config;
        const subagentId = `subagent_${index}_${Date.now()}`;
        
        try {
            // Lazy load to avoid circular dependency
            const { ChatBot } = require('../chat-bot');
            const bot = new ChatBot(this.apiKey, this.model, false);
            bot.session.workingDir = this.rootPath;
            
            this.activeSubagents.set(subagentId, bot);
            
            let fullQuery = query;
            if (relevant_context) {
                fullQuery = `Context: ${relevant_context}\n\nTask: ${query}`;
            }
            
            const response = await bot.chat(fullQuery);
            
            this.activeSubagents.delete(subagentId);
            
            return {
                subagent_id: subagentId,
                agent_name: agent_name || 'default',
                query,
                response,
                success: true
            };
        } catch (error) {
            this.activeSubagents.delete(subagentId);
            return {
                subagent_id: subagentId,
                agent_name: agent_name || 'default',
                query,
                error: error.message,
                success: false
            };
        }
    }

    listAgents() {
        return [
            {
                name: 'default',
                description: 'General purpose agent with all tools',
                capabilities: ['file_ops', 'code_intelligence', 'command_execution', 'search']
            }
        ];
    }

    cleanup() {
        for (const [id, bot] of this.activeSubagents) {
            bot.cleanup?.();
        }
        this.activeSubagents.clear();
    }
}

module.exports = { SubagentManager };
