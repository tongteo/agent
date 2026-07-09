/**
 * @fileoverview Subagent delegation tools for parallel task execution.
 */

/**
 * Register subagent delegation tools.
 * @param {import('./index').ToolRegistry} registry - Tool registry instance
 */
function registerSubagentTools(registry) {
    registry.register('use_subagent',
        async ({ command, content }) => {
            if (!registry.subagentManager) {
                return 'Error: Subagent system not initialized';
            }

            if (command === 'ListAgents') {
                const agents = registry.subagentManager.listAgents();
                return JSON.stringify(agents, null, 2);
            }

            if (command === 'InvokeSubagents') {
                if (!content || !content.subagents) {
                    return 'Error: Missing subagents array in content';
                }
                const results = await registry.subagentManager.invokeSubagents(content.subagents);
                return JSON.stringify(results, null, 2);
            }

            return 'Error: Invalid command. Use "ListAgents" or "InvokeSubagents"';
        },
        'Delegate tasks to subagents. Params: {"command": "InvokeSubagents", "content": {"subagents": [{"query": "task", "agent_name": "default", "relevant_context": "..."}]}}'
    );
}

module.exports = { registerSubagentTools };
