class AgentPrompt {
    static getSystemPrompt(toolRegistry) {
        return `You are an AI agent with access to tools. You MUST use tools to complete tasks.

CRITICAL RULES:
1. For file operations - ALWAYS use tools
2. When creating a NEW file - use write_file
3. When modifying an EXISTING file - ALWAYS use str_replace (can use multiple times if needed)
4. NEVER use write_file to modify existing files (it will overwrite everything)
5. After completing the task, respond briefly and STOP

Tool format:
<tool>tool_name</tool>
<params>{"key": "value"}</params>

Example - Modify file:
User: "change x=5 to x=10 and y=20 to y=30 in test.c"
<tool>str_replace</tool><params>{"path": "test.c", "old_str": "int x = 5;", "new_str": "int x = 10;"}</params>
<tool>str_replace</tool><params>{"path": "test.c", "old_str": "int y = 20;", "new_str": "int y = 30;"}</params>

Available tools:
${toolRegistry.getToolList()}

Remember: str_replace for modifications, write_file only for NEW files!`;
    }
}

class ToolParser {
    static parse(text) {
        const calls = [];
        const toolRegex = /<tool>(.*?)<\/tool>\s*<params>(.*?)<\/params>/gs;
        let match;
        
        while ((match = toolRegex.exec(text)) !== null) {
            try {
                let paramsStr = match[2].trim();
                // Clean up common formatting issues
                paramsStr = paramsStr.replace(/}>/g, '}');
                paramsStr = paramsStr.replace(/>\s*$/g, '');
                
                // Try to parse JSON
                let params;
                try {
                    params = JSON.parse(paramsStr);
                } catch (e) {
                    // If JSON parse fails, try to extract manually for simple cases
                    console.error(`JSON parse failed, attempting manual extraction: ${e.message}`);
                    
                    // Extract path
                    const pathMatch = paramsStr.match(/"path"\s*:\s*"([^"]+)"/);
                    // Extract content (everything between "content": " and the last ")
                    const contentMatch = paramsStr.match(/"content"\s*:\s*"([\s\S]*?)"\s*}?\s*$/);
                    
                    if (pathMatch && contentMatch) {
                        let content = contentMatch[1];
                        // Unescape JSON escape sequences
                        content = content
                            .replace(/\\n/g, '\n')
                            .replace(/\\t/g, '\t')
                            .replace(/\\r/g, '\r')
                            .replace(/\\"/g, '"')
                            .replace(/\\\\/g, '\\');
                        
                        params = {
                            path: pathMatch[1],
                            content: content
                        };
                    } else {
                        throw new Error('Could not extract params');
                    }
                }
                
                calls.push({
                    tool: match[1].trim(),
                    params: params
                });
            } catch (e) {
                console.error(`Failed to parse tool call: ${e.message}`);
            }
        }
        
        return calls;
    }
}

module.exports = { AgentPrompt, ToolParser };
