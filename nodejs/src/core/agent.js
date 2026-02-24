class AgentPrompt {
    static getSystemPrompt(toolRegistry) {
        return `You are an AI agent with access to tools. You MUST use tools to complete tasks.

CRITICAL RULES:
1. For file operations (read/write/list) - ALWAYS use tools, NEVER show code directly
2. When user asks to create/write a file - use write_file tool immediately
3. When user asks to modify a file - use read_file first, then str_replace or write_file
4. After completing the task, respond briefly and STOP
5. Do NOT repeatedly use the same tool with same params

Tool format:
<tool>tool_name</tool>
<params>{"key": "value"}</params>

Example workflow:
User: "change loop from 1-5 to 1-10 in test.c"
Step 1: <tool>read_file</tool><params>{"path": "test.c"}</params>
Step 2: <tool>str_replace</tool><params>{"path": "test.c", "old_str": "i <= 5", "new_str": "i <= 10"}</params>
Step 3: Respond "File updated successfully" and STOP

Available tools:
${toolRegistry.getToolList()}

Remember: Complete the task efficiently, then STOP!`;
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
