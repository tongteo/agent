class AgentPrompt {
    static getCompactPrompt(toolRegistry) {
        // Short prompt for models with limited context tolerance (e.g. Gemini web)
        const priority = ['read_file', 'write_file', 'str_replace', 'list_dir', 'find_files', 'execute', 'run_command', 'grep', 'append', 'read_lines', 'delete_file', 'use_subagent'];
        const allTools = toolRegistry.getToolList().split('\n');
        const tools = [
            ...priority.map(p => allTools.find(t => t.startsWith(`- ${p}:`))).filter(Boolean),
            ...allTools.filter(t => !priority.some(p => t.startsWith(`- ${p}:`)))
        ].slice(0, 14).join('\n');
        return `You are a helpful coding assistant running inside a terminal application on the user's computer. You have been given a set of actions you can perform to help complete tasks.

When you want to perform an action, write it in this format (no markdown, no backticks):
<tool>action_name</tool>
<params>{"key":"value"}</params>

Actions available:
${tools}

Example of listing files:
<tool>list_dir</tool>
<params>{"path": "."}</params>

Example of compiling a C file:
<tool>execute</tool>
<params>{"command": "gcc main.c -o main && ./main"}</params>

Please perform actions directly rather than describing them. After finishing, give a brief summary.`;
    }

    static getSystemPrompt(toolRegistry) {
        return `You are an AI agent with access to tools. You MUST use tools to complete tasks.

CRITICAL RULES:
1. For file operations - ALWAYS use tools
2. When creating a NEW file - use write_file
3. When modifying an EXISTING file - ALWAYS use str_replace (can use multiple times if needed)
4. NEVER use write_file to modify existing files (it will overwrite everything)
5. After completing the task, respond briefly and STOP
6. ALWAYS output tool calls using EXACTLY this XML format — no markdown, no prose before the tool tag

Tool format (copy exactly):
<tool>tool_name</tool>
<params>{"key": "value"}</params>

EXAMPLES (study these carefully):

Example 1 — list files:
User: "list files in /tmp"
Assistant: <tool>read_dir</tool>
<params>{"path": "/tmp"}</params>

Example 2 — read a file:
User: "show me the content of README.md"
Assistant: <tool>read_file</tool>
<params>{"path": "README.md"}</params>

Example 3 — create a file:
User: "create hello.txt with content Hello World"
Assistant: <tool>write_file</tool>
<params>{"path": "hello.txt", "content": "Hello World"}</params>

Example 4 — modify a file:
User: "change x=5 to x=10 in test.c"
Assistant: <tool>str_replace</tool>
<params>{"path": "test.c", "old_str": "int x = 5;", "new_str": "int x = 10;"}</params>

Available tools:
${toolRegistry.getToolList()}

Remember: str_replace for modifications, write_file only for NEW files!`;
    }
}

class ToolParser {
    static parse(text) {
        const calls = [];

        // Parse owl-alpha/longcat format: <longcat_tool_call>cmd</longcat_arg_value>
        const longcatRegex = /<longcat_tool_call>([\s\S]*?)<\/longcat_arg_value>/g;
        let m;
        while ((m = longcatRegex.exec(text)) !== null) {
            const command = m[1].trim();
            if (command) calls.push({ tool: 'bash', params: { command } });
        }
        if (calls.length) return calls;

        // Unescape HTML entities (Gemini web sometimes escapes XML)
        text = text.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
        // Strip markdown code fences wrapping tool calls
        text = text.replace(/```(?:xml|json)?\n([\s\S]*?)```/g, '$1');

        // Fallback: original <tool>/<params> XML format
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

class IntentParser {
    // Parse natural language response into tool calls when model doesn't use XML format
    static parse(text, context = {}) {
        const t = text.toLowerCase();
        const calls = [];

        // Don't parse intent from long explanatory responses (model is explaining, not acting)
        if (text.length > 500) return calls;

        // compile/build/run a file
        const compileMatch = text.match(/(?:compile|build|gcc|g\+\+|run)\s+[`'"]?([\w./]+\.[ch](?:pp)?)[`'"]?/i)
            || (t.includes('compil') || t.includes('build') || t.includes('gcc')) && context.lastFile?.match(/\.[ch](pp)?$/) && [null, context.lastFile];
        if (compileMatch?.[1]) {
            const file = compileMatch[1];
            const out = file.replace(/\.[^.]+$/, '');
            calls.push({ tool: 'execute', params: { command: `gcc "${file}" -o "${out}" && "./${out}"` } });
            return calls;
        }

        // read/show/display/open file
        const readMatch = text.match(/(?:read|show|display|open|view|cat)\s+[`'"]?([\w./]+\.\w+)[`'"]?/i)
            || (t.includes('read') || t.includes('show') || t.includes('display')) && context.lastFile && [null, context.lastFile];
        if (readMatch?.[1]) {
            calls.push({ tool: 'read_file', params: { path: readMatch[1] } });
            return calls;
        }

        // list files/directory
        if (t.match(/list\s+(?:the\s+)?(?:files|dir|directory|content)/)) {
            const dirMatch = text.match(/in\s+[`'"]?([\w./~-]+)[`'"]?/i);
            const dir = dirMatch?.[1];
            // ignore pronouns/articles
            const ignore = new Set(['the', 'your', 'my', 'this', 'that', 'a', 'an', 'our']);
            calls.push({ tool: 'list_dir', params: { path: (!dir || ignore.has(dir.toLowerCase())) ? '.' : dir } });
            return calls;
        }

        // run/execute a command
        const cmdMatch = text.match(/(?:run|execute|running)\s+(?:the\s+(?:command\s+)?)?[`'"]([^`'"]+)[`'"]/i);
        if (cmdMatch) {
            calls.push({ tool: 'execute', params: { command: cmdMatch[1] } });
            return calls;
        }

        return calls;
    }
}

module.exports = { AgentPrompt, ToolParser, IntentParser };
