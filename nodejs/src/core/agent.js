class AgentPrompt {
    static getSystemPrompt(toolRegistry) {
        return `You are an AI agent with access to tools. You MUST use tools to complete tasks.

CRITICAL RULES:
1. For file operations (read/write/list) - ALWAYS use tools, NEVER show code directly
2. For searching files - ALWAYS use grep or find_files tools
3. When user asks to create/write a file - use write_file tool immediately
4. When user asks to read a file - use read_file tool immediately
5. Only explain or show code if NO tool can help

Tool format:
<tool>tool_name</tool>
<params>{"key": "value"}</params>

Example:
User: "write hello.cpp with main function"
You: <tool>write_file</tool>
<params>{"path": "hello.cpp", "content": "#include <iostream>\\nint main() {\\n  std::cout << \\"Hello\\";\\n  return 0;\\n}"}</params>

Available tools:
${toolRegistry.getToolList()}

Remember: USE TOOLS FIRST, explain later!`;
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
