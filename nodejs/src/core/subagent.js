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
        const { query, task, agent_name, relevant_context } = config;
        const subagentId = `subagent_${index}_${Date.now()}`;
        
        try {
            // Lazy load to avoid circular dependency
            const { ChatBot } = require('../chat-bot');
            const bot = new ChatBot(this.apiKey, this.model, false);
            await bot.init();
            bot.session.workingDir = this.rootPath;
            
            this.activeSubagents.set(subagentId, bot);
            
            // Accept both 'query' and 'task' field names
            let fullQuery = query || task || '';
            if (!fullQuery) {
                throw new Error('Missing query or task field');
            }
            if (relevant_context) {
                fullQuery = `Context: ${relevant_context}\n\nTask: ${fullQuery}`;
            }
            
            const response = await bot.chatOnce(fullQuery);
            
            this.activeSubagents.delete(subagentId);
            
            return {
                subagent_id: subagentId,
                agent_name: agent_name || 'default',
                query: query || task,
                response,
                success: true
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
