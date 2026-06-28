const os = require('os');

function getOSContext() {
    const platform = os.platform();
    // TODO: implement Windows-specific shell/path adjustments (win32)
    if (platform === 'darwin') return 'OS: macOS. Use macOS-compatible shell commands (bash/zsh, no apt/yum).';
    if (platform === 'linux') return 'OS: Linux. Use Linux shell commands.';
    return `OS: ${platform}.`;
}

class AgentPrompt {
    static getCompactPrompt(toolRegistry) {
        // Short prompt for models with limited context tolerance (e.g. Gemini web)
        const priority = ['read_file', 'write_file', 'str_replace', 'list_dir', 'find_files', 'bash', 'execute', 'grep', 'append', 'read_lines', 'delete_file', 'use_subagent'];
        const allTools = toolRegistry.getToolList().split('\n');
        const tools = [
            ...priority.map(p => allTools.find(t => t.startsWith(`- ${p}:`))).filter(Boolean),
            ...allTools.filter(t => !priority.some(p => t.startsWith(`- ${p}:`)))
        ].slice(0, 14).join('\n');
        return `${getOSContext()}
You are a terminal agent running on the user's local machine with full filesystem and shell access via the tools below. You are NOT a web chatbot — you have real, working tool integrations. Always use a tool to act; only reply in plain text when no action is needed.

Tools available:
${tools}

Response format — emit exactly this, no markdown fences, no prose before the tag:
<tool>NAME</tool>
<params>{"key":"value"}</params>

Examples:
User: list files
<tool>list_dir</tool>
<params>{"path":"."}</params>

User: read main.c
<tool>read_file</tool>
<params>{"path":"main.c"}</params>

User: run tests
<tool>bash</tool>
<params>{"command":"npm test"}</params>`;
    }

    static getSystemPrompt(toolRegistry) {
        return `${getOSContext()}
You are an AI agent with access to tools. You MUST use tools to complete tasks.

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
                    // Escape unescaped control characters inside JSON string values
                    const sanitized = paramsStr.replace(
                        /("(?:[^"\\]|\\.)*")/gs,
                        (m) => m.replace(/[\x00-\x1f]/g, c => {
                            const map = {'\n':'\\n','\r':'\\r','\t':'\\t'};
                            return map[c] || `\\u${c.charCodeAt(0).toString(16).padStart(4,'0')}`;
                        })
                    );
                    params = JSON.parse(sanitized);
                } catch (e) {
                    // Extract path + content manually as last resort
                    const pathMatch = paramsStr.match(/"path"\s*:\s*"([^"]+)"/);
                    // Extract content (everything between "content": " and the last ")
                    const contentMatch = paramsStr.match(/"content"\s*:\s*"([\s\S]*?)"\s*}?\s*$/);
                    
                    if (pathMatch && contentMatch) {
                        let content = contentMatch[1];
                        content = content
                            .replace(/\\n/g, '\n')
                            .replace(/\\t/g, '\t')
                            .replace(/\\r/g, '\r')
                            .replace(/\\"/g, '"')
                            .replace(/\\\\/g, '\\');
                        params = { path: pathMatch[1], content };
                    } else {
                        // Generic fallback: extract all "key":"value" pairs
                        const pairs = {};
                        const kvRegex = /"(\w+)"\s*:\s*"((?:[^"\\]|\\.)*)"/g;
                        let kv;
                        while ((kv = kvRegex.exec(paramsStr)) !== null) pairs[kv[1]] = kv[2].replace(/\\n/g,'\n').replace(/\\t/g,'\t').replace(/\\"/g,'"').replace(/\\\\/g,'\\');
                        // Also extract numeric/boolean values
                        const numRegex = /"(\w+)"\s*:\s*(-?\d+(?:\.\d+)?|true|false|null)/g;
                        let nv;
                        while ((nv = numRegex.exec(paramsStr)) !== null) if (!(nv[1] in pairs)) try { pairs[nv[1]] = JSON.parse(nv[2]); } catch {}
                        if (Object.keys(pairs).length) params = pairs;
                        else throw new Error('Could not extract params');
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
    // Parse user's direct input into a tool call (for gemini-web pre-flight dispatch)
    static parseUserInput(text) {
        const t = text.trim();

        // "run fermat" / "run fermat 15" / "run ./fermat 15" / "execute fermat"
        const runMatch = t.match(/^(?:run|exec(?:ute)?)\s+[`'"]?(\.\/)?(\S+?)(?:\s+(\S+(?:\s+\S+)*))?[`'"]?$/i);
        if (runMatch) {
            const name = runMatch[2];
            if (!name.startsWith('-')) {
                const bin = `./${name.replace(/^\.\//, '')}`;
                const args = runMatch[3] ? runMatch[3].trim() : '';
                const cmd = args ? `echo '${args}' | ${bin}` : bin;
                return { tool: 'execute', params: { command: cmd } };
            }
        }

        // "compile fermat.c" / "gcc fermat.c"
        const compileMatch = t.match(/^(?:compile|gcc|g\+\+|clang)\s+[`'"]?([\w./]+\.[ch](?:pp)?)[`'"]?/i);
        if (compileMatch) {
            const file = compileMatch[1];
            const out = file.replace(/\.[^.]+$/, '');
            return { tool: 'execute', params: { command: `gcc "${file}" -o "${out}" -lm && "./${out}"` } };
        }

        // "ls" / "list files"
        if (/^(?:ls|list(?:\s+files)?)\s*(.*)$/.test(t)) {
            const dir = t.match(/\s+([\w./~-]+)$/)?.[1] || '.';
            return { tool: 'list_dir', params: { path: dir } };
        }

        return null;
    }

    // Parse natural language response into tool calls when model doesn't use XML format
    static parse(text, context = {}) {
        const t = text.toLowerCase();
        const calls = [];

        // Don't parse intent from very long explanatory responses
        if (text.length > 2000) return calls;

        // compile/build/run a file
        const compileMatch = text.match(/(?:compile|build|gcc|g\+\+)\s+[`'"]?([\w./]+\.[ch](?:pp)?)[`'"]?/i)
            || (t.includes('compil') || t.includes('build') || t.includes('gcc')) && context.lastFile?.match(/\.[ch](pp)?$/) && [null, context.lastFile];
        if (compileMatch?.[1]) {
            const file = compileMatch[1];
            const out = file.replace(/\.[^.]+$/, '');
            calls.push({ tool: 'execute', params: { command: `gcc "${file}" -o "${out}" -lm && "./${out}"` } });
            return calls;
        }

        // run/execute a binary or command (./fermat, run fermat, execute fermat, etc.)
        const runMatch = text.match(/(?:run(?:ning)?|execut(?:e|ing)|launch)\s+(?:the\s+(?:program|executable|binary|command)\s+)?[`'"]?(\.\/[\w.-]+|[\w-]+(?:\.exe)?)[`'"]?/i);
        if (runMatch?.[1]) {
            const cmd = runMatch[1].startsWith('./') ? runMatch[1] : `./${runMatch[1]}`;
            calls.push({ tool: 'execute', params: { command: cmd } });
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
