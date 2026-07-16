/**
 * @fileoverview Agent prompt templates and tool call/intent parsers.
 * Constructs system prompts for the AI model and parses tool calls from its output.
 */

const os = require('os');

function getOSContext() {
    const platform = os.platform();
    if (platform === 'darwin') return 'OS: macOS. Use macOS-compatible shell commands (bash/zsh, no apt/yum).';
    if (platform === 'linux') return 'OS: Linux. Use Linux shell commands.';
    return `OS: ${platform}.`;
}

class AgentPrompt {
    static getSystemPrompt(toolRegistry) {
        return `[System Configuration]

${getOSContext()}

You are an AI agent with tool integration capabilities. Use the provided tools to complete user tasks.

## Core Rules
- CREATE new files: use write_file
- MODIFY existing files: use str_replace (can be called multiple times)
- Never overwrite existing files with write_file — always use str_replace or insert_at_line
- After completing tasks, provide a brief confirmation
- When a tool call returns an error, ANALYZE the error and fix it — do NOT blindly retry the same failing action

## Tool Call Format
<tool>tool_name</tool>
<params>{"key": "value"}</params>

## Error Recovery
When a tool returns an error: READ the error, understand what went wrong. Never repeat the same failing call more than 1 time. If stuck after 3 attempts, try a different approach.

Tools: ${Array.from(toolRegistry.tools.keys()).join(', ')}
(Use function schemas for details. str_replace for modifications, write_file only for new files.)`;
    }
}

class ToolParser {
    static get TOOL_NAMES() {
        if (this._toolNames && this._toolNames.length > 0) return this._toolNames;
        return ['write_file', 'read_file', 'list_dir', 'str_replace', 'execute', 'bash',
                'grep', 'find_files', 'append', 'read_lines', 'delete_file', 'tree', 'git',
                'internet_search', 'analyze_code', 'package_install', 'debug_trace', 'use_subagent'];
    }

    static syncToolNames(toolRegistry) {
        if (toolRegistry && toolRegistry.tools) {
            this._toolNames = Array.from(toolRegistry.tools.keys());
        }
    }

    static parse(text) {
        const calls = [];

        // longcat format
        const longcatRegex = /<longcat_tool_call>([\s\S]*?)<\/longcat_arg_value>/g;
        let m;
        while ((m = longcatRegex.exec(text)) !== null) {
            const command = m[1].trim();
            if (command) calls.push({ tool: 'bash', params: { command } });
        }
        if (calls.length) return calls;

        // Unescape HTML entities, strip fences
        text = text.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
        text = text.replace(/```(?:xml|json)?\n([\s\S]*?)```/g, '$1');

        // XML <tool>/<params> format
        const toolRegex = /<tool>(.*?)<\/tool>\s*<params>(.*?)<\/params>/gs;
        let match;
        while ((match = toolRegex.exec(text)) !== null) {
            const parsed = ToolParser._parseParams(match[1].trim(), match[2].trim());
            if (parsed) calls.push(parsed);
        }
        if (calls.length) return calls;

        // JSON format: tool_name followed by JSON object
        calls.push(...ToolParser._parseJsonFormat(text));
        if (calls.length) return calls;

        return calls;
    }

    static _parseJsonFormat(text) {
        const calls = [];
        const toolPattern = ToolParser.TOOL_NAMES.map(n =>
            n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        ).join('|');
        const nameRegex = new RegExp('(?<![\\w])(' + toolPattern + ')(?![\\w])', 'g');

        let cursor = 0;
        let m;
        while ((m = nameRegex.exec(text)) !== null) {
            const tool = m[1].trim();
            const searchStart = m.index + m[0].length;
            nameRegex.lastIndex = searchStart;
            const nextMatch = nameRegex.exec(text);
            const searchEnd = nextMatch ? nextMatch.index : text.length;
            nameRegex.lastIndex = searchStart;
            const snippet = text.slice(searchStart, searchEnd);
            const jsonStr = ToolParser._extractJsonBraces(snippet);
            if (jsonStr) {
                const parsed = ToolParser._parseParams(tool, jsonStr);
                if (parsed) {
                    calls.push(parsed);
                    const jsonEnd = searchStart + snippet.indexOf(jsonStr) + jsonStr.length;
                    nameRegex.lastIndex = jsonEnd;
                    cursor = jsonEnd;
                    continue;
                }
            }
            cursor = searchStart;
            nameRegex.lastIndex = cursor;
        }
        return calls;
    }

    static _extractJsonBraces(str) {
        let depth = 0;
        let start = -1;
        for (let i = 0; i < str.length; i++) {
            const ch = str[i];
            if (ch === '{') {
                if (depth === 0) start = i;
                depth++;
            } else if (ch === '}') {
                depth--;
                if (depth === 0 && start >= 0) {
                    return str.substring(start, i + 1);
                }
            }
        }
        return null;
    }

    static _parseParams(tool, paramsStr) {
        paramsStr = paramsStr.trim();
        paramsStr = paramsStr.replace(/}>/g, '}');
        paramsStr = paramsStr.replace(/>\s*$/g, '');

        // Try JSON.parse
        try {
            const params = JSON.parse(paramsStr);
            return { tool, params };
        } catch (e) {
            // Sanitize control chars inside strings
            try {
                const sanitized = paramsStr.replace(
                    /("(?:[^"\\]|\\.)*")/gs,
                    (m) => m.replace(/[\x00-\x1f]/g, c => {
                        const map = { '\n': '\\n', '\r': '\\r', '\t': '\\t' };
                        return map[c] || `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`;
                    })
                );
                const params = JSON.parse(sanitized);
                return { tool, params };
            } catch (e2) {
                return ToolParser._extractParamsManually(tool, paramsStr);
            }
        }
    }

    static _extractParamsManually(tool, paramsStr) {
        const params = {};

        // Find "key": " and read value char-by-char.
        // For content values (C code), unescaped " inside C strings are
        // accepted; only stop when " is followed by JSON delimiters.
        const extractValue = (key, isContent = false) => {
            const keyRe = new RegExp(
                '"' + key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') +
                '"\\s*:\\s*"', 's'
            );
            const m = paramsStr.match(keyRe);
            if (!m) return null;

            let i = m.index + m[0].length;
            let result = '';
            while (i < paramsStr.length) {
                const ch = paramsStr[i];
                if (ch === '\\') {
                    // Decode JSON escape sequences during scan
                    i++;
                    if (i >= paramsStr.length) break;
                    const next = paramsStr[i];
                    if (next === 'n') result += '\n';       // \n -> newline
                    else if (next === 't') result += '\t';  // \t -> tab
                    else if (next === 'r') result += '\x0d';  // CR
                    else if (next === '"') result += '"';    // quote
                    else if (next === '\\') result += '\\';  // \\ -> \
                    else { result += ch; result += next; }  // unknown: preserve
                    i++;
                } else if (ch === '"') {
                    if (!isContent) break;
                    const rest = paramsStr.slice(i + 1);
                    if (/^\s*}\s*/.test(rest) || /^\s*,\s*"/.test(rest) || /^\s*"\s*[a-zA-Z_]/.test(rest)) break;
                    result += ch;
                    i++;
                } else {
                    result += ch;
                    i++;
                }
            }
            return result;
        };

        const path = extractValue('path');
        if (path) params.path = path;

        const contentRaw = extractValue('content', true);
        if (contentRaw) {
            params.content = contentRaw;
        }

        const command = extractValue('command', true);
        if (command) params.command = command;
        const query = extractValue('query');
        if (query) params.query = query;
        const working_dir = extractValue('working_dir');
        if (working_dir) params.working_dir = working_dir;

        // Numeric/boolean/null keys
        const numRegex = /"(\w+)"\s*:\s*(-?\d+(?:\.\d+)?|true|false|null)/g;
        let nv;
        while ((nv = numRegex.exec(paramsStr)) !== null) {
            if (!(nv[1] in params)) {
                try { params[nv[1]] = JSON.parse(nv[2]); } catch {}
            }
        }

        if (Object.keys(params).length > 0) return { tool, params };

        // Last resort
        const pairs = {};
        const kvRegex = /"(\w+)"\s*:\s*"((?:[^"\\]|\\.)*)"/g;
        let kv;
        while ((kv = kvRegex.exec(paramsStr)) !== null) {
            pairs[kv[1]] = kv[2]
                .replace(/\\n/g, '\n').replace(/\\t/g, '\t')
                .replace(/\\"/g, '"').replace(/\\\\/g, '\\');
        }
        if (Object.keys(pairs).length) return { tool, params: pairs };

        return null;
    }
}

class IntentParser {
    static parseUserInput(text, options = {}) {
        const t = text.trim();
        const { lastFile } = options || {};
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
        // Match compile/build/run with file path, including Vietnamese keywords
        let compileMatch = t.match(/^(?:compile|build|gcc|g\+\+|clang|python3?|py|biên.dịch|chạy)\s+[`'"]?([\w./]+\.[\w]+)[`'"]?/i);
        // Fallback: user said compile/run keywords but no file — use lastFile
        if (!compileMatch && lastFile && t.match(/^(?:compile|build|run|gcc|g\+\+|clang|chạy|biên.dịch|dịch|chạy.thử)\b/i)) {
            compileMatch = [null, lastFile];
        }
        if (compileMatch) {
            const file = compileMatch[1];
            const ext = file.split('.').pop().toLowerCase();
            const out = file.replace(/\.[^.]+$/, '');
            if (ext === 'c') {
                return { tool: 'execute', params: { command: `gcc "${file}" -o "${out}" -lm && "./${out}"` } };
            } else if (ext === 'cpp' || ext === 'cc' || ext === 'cxx') {
                return { tool: 'execute', params: { command: `g++ "${file}" -o "${out}" && "./${out}"` } };
            } else if (ext === 'py' || ext === 'python') {
                return { tool: 'execute', params: { command: `python3 "${file}"` } };
            } else {
                return { tool: 'execute', params: { command: `gcc "${file}" -o "${out}" -lm && "./${out}"` } };
            }
        }
        if (/^(?:ls|list(?:\s+files)?)\s*(.*)$/.test(t)) {
            const dir = t.match(/\s+([\w./~-]+)$/)?.[1] || '.';
            return { tool: 'list_dir', params: { path: dir } };
        }
        return null;
    }

    static parse(text, context = {}) {
        const calls = [];
        const searchText = text.length > 3000 ? text.substring(0, 3000) : text;
        const searchT = searchText.toLowerCase();

        const compileMatch = searchText.match(/(?:compile|build|gcc|g\+\+|clang|python3?|py)\s+[`'"]?([\w./]+\.[\w]+)[`'"]?/i)
            || (searchT.includes('compil') || searchT.includes('build') || searchT.includes('gcc') || searchT.includes('python') || searchT.includes('compile')) && context.lastFile && [null, context.lastFile];
        if (compileMatch?.[1]) {
            const file = compileMatch[1];
            const ext = file.split('.').pop().toLowerCase();
            const out = file.replace(/\.[^.]+$/, '');
            if (ext === 'c') {
                calls.push({ tool: 'execute', params: { command: `gcc "${file}" -o "${out}" -lm && "./${out}"` } });
            } else if (ext === 'cpp' || ext === 'cc' || ext === 'cxx') {
                calls.push({ tool: 'execute', params: { command: `g++ "${file}" -o "${out}" && "./${out}"` } });
            } else if (ext === 'py' || ext === 'python') {
                calls.push({ tool: 'execute', params: { command: `python3 "${file}"` } });
            } else {
                calls.push({ tool: 'execute', params: { command: `gcc "${file}" -o "${out}" -lm && "./${out}"` } });
            }
            return calls;
        }
        const runMatch = searchText.match(/(?:run(?:ning)?|execut(?:e|ing)|launch)\s+(?:the\s+(?:program|executable|binary|command)\s+)?[`'"]?(\.\/[\w.-]+|[\w-]+(?:\.exe)?)[`'"]?/i);
        if (runMatch?.[1]) {
            const cmd = runMatch[1].startsWith('./') ? runMatch[1] : `./${runMatch[1]}`;
            calls.push({ tool: 'execute', params: { command: cmd } });
            return calls;
        }
        const readMatch = searchText.match(/(?:read|show|display|open|view|cat)\s+[`'"]?([\w./]+\.[a-zA-Z]+)[`'"]?/i)
            || (searchT.includes('read') || searchT.includes('show') || searchT.includes('display')) && context.lastFile && [null, context.lastFile];
        if (readMatch?.[1]) {
            calls.push({ tool: 'read_file', params: { path: readMatch[1] } });
            return calls;
        }
        if (searchT.match(/list\s+(?:the\s+)?(?:files|dir|directory|content)/)) {
            const dirMatch = searchText.match(/in\s+[`'"]?([\w./~-]+)[`'"]?/i);
            const dir = dirMatch?.[1];
            const ignore = new Set(['the', 'your', 'my', 'this', 'that', 'a', 'an', 'our']);
            calls.push({ tool: 'list_dir', params: { path: (!dir || ignore.has(dir.toLowerCase())) ? '.' : dir } });
            return calls;
        }
        const cmdMatch = searchText.match(/(?:run|execute|running)\s+(?:the\s+(?:command\s+)?)?[`'"]([^`'"]+)[`'"]/i);
        if (cmdMatch) {
            calls.push({ tool: 'execute', params: { command: cmdMatch[1] } });
            return calls;
        }
        return calls;
    }
}

module.exports = { AgentPrompt, ToolParser, IntentParser };
