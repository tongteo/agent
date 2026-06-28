const fs = require('fs');
const path = require('path');
const { execSync, execFileSync } = require('child_process');
const { LSPClient } = require('./lsp');
const { DiffFormatter } = require('../ui/diff');

const IS_WINDOWS = process.platform === 'win32';

// Neutralize prompt-injection payloads that may appear in tool output
// (e.g. file contents, shell stdout, web page text). We HTML-escape any tag
// that could be mistaken for a trusted system/instruction channel, and break
// up [SYSTEM: ...] style markers with a zero-width space so they no longer
// match the model's expected runtime-context pattern. This is a defense in
// depth — the system prompt also instructs the model to treat tool output as
// data only.
const INJECTION_TAG_RE = /<(\/?)(system_reminder|system|developer|admin|instruction|sudo|tool_result|past_tool_use|project_instructions)\b([^>]*)>/gi;
function sanitizeToolOutput(text) {
    if (text == null) return text;
    if (typeof text !== 'string') {
        try { text = String(text); } catch { return text; }
    }
    return text
        .replace(INJECTION_TAG_RE, '&lt;$1$2$3&gt;')
        .replace(/\[SYSTEM:/gi, '[SYSTEM\u200B:')
        .replace(/\[\/?INST\]/gi, m => m.replace('[', '[\u200B'));
}

function commandExists(cmd) {
    try {
        const probe = IS_WINDOWS ? 'where' : 'which';
        execFileSync(probe, [cmd], { stdio: 'ignore' });
        return true;
    } catch {
        return false;
    }
}

function resolvePython() {
    if (IS_WINDOWS) {
        if (commandExists('py')) return { cmd: 'py', prefixArgs: ['-3'] };
        if (commandExists('python')) return { cmd: 'python', prefixArgs: [] };
        return { cmd: 'python3', prefixArgs: [] };
    }
    return { cmd: commandExists('python3') ? 'python3' : 'python', prefixArgs: [] };
}

function quoteArg(arg) {
    if (arg === '' || arg == null) return '""';
    const s = String(arg);
    if (IS_WINDOWS) {
        if (/[\s"&|<>^()%!]/.test(s)) {
            return '"' + s.replace(/"/g, '\\"') + '"';
        }
        return s;
    }
    if (/[^A-Za-z0-9_\-./=:]/.test(s)) {
        return "'" + s.replace(/'/g, "'\\''") + "'";
    }
    return s;
}

function buildCmd(parts) {
    return parts.map(quoteArg).join(' ');
}

class ToolRegistry {
    constructor(session) {
        this.tools = new Map();
        this.lspClients = new Map();
        this.session = session;
        this.registerDefaultTools();
    }

    register(name, fn, description) {
        this.tools.set(name, { fn, description });
    }

    async execute(name, params) {
        const tool = this.tools.get(name);
        if (!tool) throw new Error(`Tool not found: ${name}`);
        return await tool.fn(params);
    }

    getToolList() {
        return Array.from(this.tools.entries()).map(([name, { description }]) => 
            `- ${name}: ${description}`
        ).join('\n');
    }

    getToolSchemas() {
        const paramRegex = /Params: ({.*})/;
        return Array.from(this.tools.entries()).map(([name, { description }]) => {
            const match = description.match(paramRegex);
            let properties = {}, required = [];
            if (match) {
                try {
                    const example = JSON.parse(match[1]);
                    for (const [k, v] of Object.entries(example)) {
                        properties[k] = { type: Array.isArray(v) ? 'array' : typeof v };
                        if (typeof v === 'string' || typeof v === 'number') required.push(k);
                    }
                } catch {}
            }
            return {
                type: 'function',
                function: {
                    name,
                    description: description.replace(/\. Params:.*/, ''),
                    parameters: { type: 'object', properties, required }
                }
            };
        });
    }

    async initLSP(language, rootPath) {
        const lspConfigs = {
            typescript: { cmd: 'typescript-language-server', args: ['--stdio'] },
            javascript: { cmd: 'typescript-language-server', args: ['--stdio'] },
            python: { cmd: 'pylsp', args: [] },
            rust: { cmd: 'rust-analyzer', args: [] },
            c: { cmd: 'clangd', args: [] },
            cpp: { cmd: 'clangd', args: [] },
            html: { cmd: 'vscode-html-language-server', args: ['--stdio'] },
            css: { cmd: 'vscode-css-language-server', args: ['--stdio'] }
        };

        const config = lspConfigs[language];
        if (!config) return null;

        const client = new LSPClient(config.cmd, config.args, rootPath);
        try {
            await client.start();
            this.lspClients.set(language, client);
            return client;
        } catch (e) {
            return null;
        }
    }

    async cleanup() {
        for (const client of this.lspClients.values()) {
            await client.stop();
        }
        this.lspClients.clear();
    }

    registerDefaultTools() {
        this.register('read_file', async ({ path: filePath }) => {
            try {
                return fs.readFileSync(filePath, 'utf-8');
            } catch (e) {
                return `Error: ${e.message}`;
            }
        }, 'Read file content. Params: {"path": "file.txt"}');

        this.register('write_file', async ({ path: filePath, content }) => {
            try {
                const exists = fs.existsSync(filePath);
                const oldContent = exists ? fs.readFileSync(filePath, 'utf-8') : null;
                
                fs.writeFileSync(filePath, content);
                
                if (exists) {
                    const diff = DiffFormatter.formatDiff(oldContent, content, filePath);
                    return diff || 'File written successfully (no changes)';
                } else {
                    return DiffFormatter.formatCreate(content, filePath);
                }
            } catch (e) {
                return `Error: ${e.message}`;
            }
        }, 'Write to file. Params: {"path": "file.txt", "content": "..."}');

        this.register('list_dir', async ({ path: dirPath = '.' }) => {
            try {
                const files = fs.readdirSync(dirPath);
                return files.join('\n');
            } catch (e) {
                return `Error: ${e.message}`;
            }
        }, 'List directory. Params: {"path": "."}');

        this.register('grep', async ({ pattern, path: searchPath = '.' }) => {
            let re;
            try {
                re = new RegExp(pattern);
            } catch (e) {
                return `Error: invalid regex pattern: ${e.message}`;
            }
            try {
                const matches = [];
                const skip = new Set(['node_modules', '.git', 'dist', 'build', '.next', '__pycache__']);
                const deadline = Date.now() + 5000;
                const maxBytes = 1 * 1024 * 1024;
                let totalBytes = 0;

                const walk = (dir) => {
                    if (Date.now() > deadline || totalBytes >= maxBytes) return;
                    let entries;
                    try {
                        entries = fs.readdirSync(dir, { withFileTypes: true });
                    } catch { return; }
                    for (const entry of entries) {
                        if (Date.now() > deadline || totalBytes >= maxBytes) return;
                        if (skip.has(entry.name)) continue;
                        const full = path.join(dir, entry.name);
                        if (entry.isDirectory()) {
                            walk(full);
                        } else if (entry.isFile()) {
                            let content;
                            try {
                                content = fs.readFileSync(full, 'utf-8');
                            } catch { continue; }
                            const lines = content.split(/\r?\n/);
                            for (let i = 0; i < lines.length; i++) {
                                if (re.test(lines[i])) {
                                    const line = `${full}:${i + 1}:${lines[i]}`;
                                    matches.push(line);
                                    totalBytes += line.length + 1;
                                    if (totalBytes >= maxBytes) return;
                                }
                            }
                        }
                    }
                };

                const stat = fs.statSync(searchPath);
                if (stat.isFile()) {
                    const content = fs.readFileSync(searchPath, 'utf-8');
                    content.split(/\r?\n/).forEach((l, i) => {
                        if (re.test(l)) matches.push(`${searchPath}:${i + 1}:${l}`);
                    });
                } else {
                    walk(searchPath);
                }
                return matches.length ? matches.join('\n') : 'No matches found';
            } catch (e) {
                return `Error: ${e.message}`;
            }
        }, 'Search in files. Params: {"pattern": "TODO", "path": "."}');

        this.register('find_files', async ({ pattern, path: searchPath = '.' }) => {
            try {
                // Convert glob pattern to regex (supports *, ?, and literals)
                const escapeRegex = (s) => s.replace(/[.+^${}()|[\]\\]/g, '\\$&');
                const reSrc = '^' + escapeRegex(pattern).replace(/\\\*/g, '.*').replace(/\\\?/g, '.') + '$';
                const re = new RegExp(reSrc, IS_WINDOWS ? 'i' : '');
                const skip = new Set(['node_modules', '.git', 'dist', 'build', '.next', '__pycache__']);
                const results = [];

                const walk = (dir) => {
                    let entries;
                    try {
                        entries = fs.readdirSync(dir, { withFileTypes: true });
                    } catch { return; }
                    for (const entry of entries) {
                        if (skip.has(entry.name)) continue;
                        const full = path.join(dir, entry.name);
                        if (re.test(entry.name)) results.push(full);
                        if (entry.isDirectory()) walk(full);
                    }
                };

                walk(searchPath);
                return results.length ? results.join('\n') : 'No files found';
            } catch (e) {
                return `Error: ${e.message}`;
            }
        }, 'Find files by name. Params: {"pattern": "*.js", "path": "."}');

        // Advanced file operations
        this.register('str_replace', async ({ path: filePath, old_str, new_str }) => {
            try {
                const content = fs.readFileSync(filePath, 'utf-8');
                const occurrences = (content.match(new RegExp(old_str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;
                
                if (occurrences === 0) return 'Error: old_str not found';
                if (occurrences > 1) return `Error: old_str found ${occurrences} times (must be unique)`;
                
                const newContent = content.slice(0, content.indexOf(old_str)) + new_str + content.slice(content.indexOf(old_str) + old_str.length);
                fs.writeFileSync(filePath, newContent);
                
                const diff = DiffFormatter.formatDiff(content, newContent, filePath);
                return diff || 'Replacement successful';
            } catch (e) {
                return `Error: ${e.message}`;
            }
        }, 'Replace text in file. Params: {"path": "file.txt", "old_str": "old", "new_str": "new"}');

        this.register('insert_at_line', async ({ path: filePath, line, content }) => {
            try {
                const oldContent = fs.readFileSync(filePath, 'utf-8');
                const lines = oldContent.split('\n');
                if (line < 0 || line > lines.length) return `Error: line ${line} out of range`;
                
                lines.splice(line, 0, content);
                const newContent = lines.join('\n');
                fs.writeFileSync(filePath, newContent);
                
                const diff = DiffFormatter.formatDiff(oldContent, newContent, filePath);
                return diff || `Inserted at line ${line}`;
            } catch (e) {
                return `Error: ${e.message}`;
            }
        }, 'Insert content at line. Params: {"path": "file.txt", "line": 5, "content": "new line"}');

        this.register('append', async ({ path: filePath, content }) => {
            try {
                fs.appendFileSync(filePath, content);
                return 'Content appended';
            } catch (e) {
                return `Error: ${e.message}`;
            }
        }, 'Append to file. Params: {"path": "file.txt", "content": "..."}');

        this.register('read_lines', async ({ path: filePath, start, end }) => {
            try {
                const lines = fs.readFileSync(filePath, 'utf-8').split('\n');
                const startIdx = start < 0 ? lines.length + start : start - 1;
                const endIdx = end < 0 ? lines.length + end + 1 : end;
                
                if (startIdx < 0 || endIdx > lines.length) return 'Error: line range out of bounds';
                
                return lines.slice(startIdx, endIdx).join('\n');
            } catch (e) {
                return `Error: ${e.message}`;
            }
        }, 'Read line range. Params: {"path": "file.txt", "start": 1, "end": 10}');

        // LSP tools
        this.register('goto_definition', async ({ file, line, character }) => {
            try {
                const ext = file.split('.').pop();
                const langMap = { 
                    js: 'javascript', ts: 'typescript', 
                    py: 'python', rs: 'rust',
                    c: 'c', cpp: 'cpp', cc: 'cpp', cxx: 'cpp', h: 'cpp', hpp: 'cpp',
                    html: 'html', htm: 'html',
                    css: 'css'
                };
                const lang = langMap[ext];
                
                if (!lang) return 'Language not supported';
                
                let client = this.lspClients.get(lang);
                if (!client) {
                    client = await this.initLSP(lang, this.session?.workingDir || process.cwd());
                    if (!client) return 'LSP not available';
                }
                
                const result = await client.gotoDefinition(path.resolve(file), line, character);
                return JSON.stringify(result, null, 2);
            } catch (e) {
                return `Error: ${e.message}`;
            }
        }, 'Go to definition. Params: {"file": "file.js", "line": 10, "character": 5}');

        this.register('find_references', async ({ file, line, character }) => {
            try {
                const ext = file.split('.').pop();
                const langMap = { 
                    js: 'javascript', ts: 'typescript', 
                    py: 'python', rs: 'rust',
                    c: 'c', cpp: 'cpp', cc: 'cpp', cxx: 'cpp', h: 'cpp', hpp: 'cpp',
                    html: 'html', htm: 'html',
                    css: 'css'
                };
                const lang = langMap[ext];
                
                if (!lang) return 'Language not supported';
                
                let client = this.lspClients.get(lang);
                if (!client) {
                    client = await this.initLSP(lang, this.session?.workingDir || process.cwd());
                    if (!client) return 'LSP not available';
                }
                
                const result = await client.findReferences(path.resolve(file), line, character);
                return JSON.stringify(result, null, 2);
            } catch (e) {
                return `Error: ${e.message}`;
            }
        }, 'Find references. Params: {"file": "file.js", "line": 10, "character": 5}');

        this.register('get_symbols', async ({ file }) => {
            try {
                const ext = file.split('.').pop();
                const langMap = { 
                    js: 'javascript', ts: 'typescript', 
                    py: 'python', rs: 'rust',
                    c: 'c', cpp: 'cpp', cc: 'cpp', cxx: 'cpp', h: 'cpp', hpp: 'cpp',
                    html: 'html', htm: 'html',
                    css: 'css'
                };
                const lang = langMap[ext];
                
                if (!lang) return 'Language not supported';
                
                let client = this.lspClients.get(lang);
                if (!client) {
                    client = await this.initLSP(lang, this.session?.workingDir || process.cwd());
                    if (!client) return 'LSP not available';
                }
                
                const result = await client.getDocumentSymbols(path.resolve(file));
                return JSON.stringify(result, null, 2);
            } catch (e) {
                return `Error: ${e.message}`;
            }
        }, 'Get document symbols. Params: {"file": "file.js"}');

        this.register('get_diagnostics', async ({ file }) => {
            try {
                const ext = file.split('.').pop();
                const langMap = { 
                    js: 'javascript', ts: 'typescript', 
                    py: 'python', rs: 'rust',
                    c: 'c', cpp: 'cpp', cc: 'cpp', cxx: 'cpp', h: 'cpp', hpp: 'cpp',
                    html: 'html', htm: 'html',
                    css: 'css'
                };
                const lang = langMap[ext];
                
                if (!lang) return 'Language not supported';
                
                let client = this.lspClients.get(lang);
                if (!client) {
                    client = await this.initLSP(lang, this.session?.workingDir || process.cwd());
                    if (!client) return 'LSP not available';
                }
                
                const result = await client.getDiagnostics(path.resolve(file));
                return JSON.stringify(result, null, 2);
            } catch (e) {
                return `Error: ${e.message}`;
            }
        }, 'Get diagnostics (errors/warnings). Params: {"file": "file.js"}');

        this.register('rename_symbol', async ({ file, line, character, new_name }) => {
            try {
                const ext = file.split('.').pop();
                const langMap = { 
                    js: 'javascript', ts: 'typescript', 
                    py: 'python', rs: 'rust',
                    c: 'c', cpp: 'cpp', cc: 'cpp', cxx: 'cpp', h: 'cpp', hpp: 'cpp',
                    html: 'html', htm: 'html',
                    css: 'css'
                };
                const lang = langMap[ext];
                
                if (!lang) return 'Language not supported';
                
                let client = this.lspClients.get(lang);
                if (!client) {
                    client = await this.initLSP(lang, this.session?.workingDir || process.cwd());
                    if (!client) return 'LSP not available';
                }
                
                const result = await client.renameSymbol(path.resolve(file), line, character, new_name);
                return JSON.stringify(result, null, 2);
            } catch (e) {
                return `Error: ${e.message}`;
            }
        }, 'Rename symbol. Params: {"file": "file.js", "line": 10, "character": 5, "new_name": "newName"}');

        this.register('workspace_symbols', async ({ query }) => {
            try {
                // Use first available LSP client
                const client = Array.from(this.lspClients.values())[0];
                if (!client) {
                    // Try to init typescript LSP as default
                    const tsClient = await this.initLSP('javascript', this.session?.workingDir || process.cwd());
                    if (!tsClient) return 'LSP not available';
                    const result = await tsClient.getWorkspaceSymbols(query);
                    return JSON.stringify(result, null, 2);
                }
                
                const result = await client.getWorkspaceSymbols(query);
                return JSON.stringify(result, null, 2);
            } catch (e) {
                return `Error: ${e.message}`;
            }
        }, 'Search symbols in workspace. Params: {"query": "MyClass"}');

        this.register('use_subagent', async ({ command, content }) => {
            if (!this.subagentManager) {
                return 'Error: Subagent system not initialized';
            }

            if (command === 'ListAgents') {
                const agents = this.subagentManager.listAgents();
                return JSON.stringify(agents, null, 2);
            }

            if (command === 'InvokeSubagents') {
                if (!content || !content.subagents) {
                    return 'Error: Missing subagents array in content';
                }
                const results = await this.subagentManager.invokeSubagents(content.subagents);
                return JSON.stringify(results, null, 2);
            }

            return 'Error: Invalid command. Use "ListAgents" or "InvokeSubagents"';
        }, 'Delegate tasks to subagents. Params: {"command": "InvokeSubagents", "content": {"subagents": [{"query": "task", "agent_name": "default", "relevant_context": "..."}]}}');

        // Execute tool
        this.register('execute', async ({ file, command, args = '', stdin = '' }) => {
            if (command && !file) {
                return this.tools.get('bash').fn({ command });
            }
            try {
                if (!file) return 'Error: missing required param "file"';
                const ext = file.split('.').pop().toLowerCase();
                const exeSuffix = IS_WINDOWS ? '.exe' : '';
                const runPrefix = IS_WINDOWS ? '' : './';
                let cmd;

                if (ext === 'py') {
                    const py = resolvePython();
                    cmd = buildCmd([py.cmd, ...py.prefixArgs, file]) + (args ? ' ' + args : '');
                } else if (ext === 'js') {
                    cmd = buildCmd(['node', file]) + (args ? ' ' + args : '');
                } else if (ext === 'ts') {
                    const runner = commandExists('tsx') ? 'tsx' : (commandExists('ts-node') ? 'ts-node' : null);
                    if (!runner) return 'Error: tsx or ts-node not found';
                    cmd = buildCmd([runner, file]) + (args ? ' ' + args : '');
                } else if (ext === 'sh' || ext === 'bash') {
                    if (IS_WINDOWS && !commandExists('bash')) {
                        return 'Error: bash not found on Windows. Install Git Bash or WSL.';
                    }
                    cmd = buildCmd(['bash', file]) + (args ? ' ' + args : '');
                } else if (ext === 'ps1') {
                    cmd = buildCmd(['powershell', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', file]) + (args ? ' ' + args : '');
                } else if (ext === 'c') {
                    const out = file.replace(/\.c$/i, '') + exeSuffix;
                    cmd = buildCmd(['gcc', file, '-o', out]) + ' && ' + buildCmd([runPrefix + out]) + (args ? ' ' + args : '');
                } else if (ext === 'cpp' || ext === 'cc' || ext === 'cxx') {
                    const out = file.replace(/\.(cpp|cc|cxx)$/i, '') + exeSuffix;
                    cmd = buildCmd(['g++', file, '-o', out]) + ' && ' + buildCmd([runPrefix + out]) + (args ? ' ' + args : '');
                } else if (ext === 'rs') {
                    const out = file.replace(/\.rs$/i, '') + exeSuffix;
                    cmd = buildCmd(['rustc', file, '-o', out]) + ' && ' + buildCmd([runPrefix + out]) + (args ? ' ' + args : '');
                } else if (ext === 'go') {
                    cmd = buildCmd(['go', 'run', file]) + (args ? ' ' + args : '');
                } else if (ext === 'java') {
                    const baseName = path.basename(file).replace(/\.java$/i, '');
                    const dir = path.dirname(file) || '.';
                    cmd = buildCmd(['javac', file]) + ' && ' + buildCmd(['java', '-cp', dir, baseName]) + (args ? ' ' + args : '');
                } else {
                    return `Error: Unsupported file type: ${ext}`;
                }

                const options = {
                    encoding: 'utf-8',
                    maxBuffer: 10 * 1024 * 1024,
                    timeout: 30000,
                    cwd: this.session?.workingDir || process.cwd(),
                    shell: IS_WINDOWS ? true : '/bin/sh'
                };

                if (stdin) {
                    options.input = stdin;
                }

                const result = execSync(cmd, options);
                return result || '(no output)';
            } catch (e) {
                return `Error: ${e.message}\n${e.stderr || ''}`;
            }
        }, 'Compile and execute code file. Params: {"file": "main.py", "args": "arg1 arg2", "stdin": "input data"}');

        this.register('bash', async ({ command, working_dir }) => {
            const trimmed = command.trim();
            const stripValue = (raw) => {
                let v = raw.replace(/\s*#.*$/, '').trim();
                v = v.replace(/^(['"])(.*)\1$/, '$2');
                return v;
            };
            const envMatch =
                trimmed.match(/^export\s+([A-Za-z_][A-Za-z0-9_]*)=(.*)$/) ||
                trimmed.match(/^set\s+([A-Za-z_][A-Za-z0-9_]*)=(.*)$/i) ||
                trimmed.match(/^\$env:([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
            if (envMatch) {
                const key = envMatch[1];
                const val = stripValue(envMatch[2]);
                process.env[key] = val;
                return `Exported: ${key}=${val}`;
            }
            try {
                const shellOpt = IS_WINDOWS ? (commandExists('bash') ? 'bash' : true) : '/bin/sh';
                const result = execSync(command, {
                    shell: shellOpt,
                    encoding: 'utf-8',
                    maxBuffer: 10 * 1024 * 1024,
                    timeout: 30000,
                    env: process.env,
                    cwd: working_dir || this.session?.workingDir || process.cwd()
                });
                return result || '(no output)';
            } catch (e) {
                return `Error: ${e.message}\n${e.stderr || ''}`;
            }
        }, 'Execute shell command. Params: {"command": "ls -la", "working_dir": "/path"}');

        this.register('tree', async ({ path: dirPath = '.', depth = 2, ignore = [] }) => {
            const ignorePatterns = ['node_modules', '.git', 'dist', 'build', ...ignore];
            try {
                return this.manualTree(dirPath, depth, ignorePatterns) || '(empty)';
            } catch (e) {
                return `Error: ${e.message}`;
            }
        }, 'Show directory tree. Params: {"path": ".", "depth": 2, "ignore": ["tmp"]}');

        this.register('git', async ({ action, message, branch }) => {
            try {
                let cmd;
                if (action === 'status') {
                    cmd = 'git status --short';
                } else if (action === 'diff') {
                    cmd = 'git diff';
                } else if (action === 'log') {
                    cmd = 'git log --oneline -10';
                } else if (action === 'commit') {
                    execFileSync('git', ['add', '-A'], { encoding: 'utf-8', timeout: 30000 });
                    const result = execFileSync('git', ['commit', '-m', message], { encoding: 'utf-8', timeout: 30000 });
                    return result || 'Success';
                } else if (action === 'push') {
                    cmd = 'git push';
                } else if (action === 'pull') {
                    cmd = 'git pull';
                } else if (action === 'branch') {
                    if (branch) {
                        const result = execFileSync('git', ['checkout', '-b', branch], {
                            encoding: 'utf-8',
                            timeout: 30000,
                            cwd: this.session?.workingDir || process.cwd()
                        });
                        return result || `Created and switched to branch ${branch}`;
                    }
                    cmd = 'git branch';
                } else {
                    return 'Error: Invalid action. Use: status, diff, log, commit, push, pull, branch';
                }
                
                const result = execSync(cmd, { encoding: 'utf-8', timeout: 30000 });
                return result || 'Success';
            } catch (e) {
                return `Error: ${e.message}\n${e.stderr || ''}`;
            }
        }, 'Git operations. Params: {"action": "status|diff|log|commit|push|pull|branch", "message": "...", "branch": "..."}');

        this.register('analyze_code', async ({ path: filePath }) => {
            try {
                const content = fs.readFileSync(filePath, 'utf-8');
                const lines = content.split('\n');
                const ext = filePath.split('.').pop();
                
                // Basic analysis
                const stats = {
                    file: filePath,
                    language: ext,
                    total_lines: lines.length,
                    code_lines: lines.filter(l => l.trim() && !l.trim().match(/^(\/\/|#|\*|\/\*)/)).length,
                    blank_lines: lines.filter(l => !l.trim()).length,
                    comment_lines: lines.filter(l => l.trim().match(/^(\/\/|#|\*|\/\*)/)).length
                };
                
                // Find functions/classes
                const functions = [];
                const classes = [];
                
                lines.forEach((line, i) => {
                    if (/function\s+(\w+)/.test(line)) {
                        functions.push({ name: line.match(/function\s+(\w+)/)[1], line: i + 1 });
                    }
                    if (/class\s+(\w+)/.test(line)) {
                        classes.push({ name: line.match(/class\s+(\w+)/)[1], line: i + 1 });
                    }
                    if (/def\s+(\w+)/.test(line)) {
                        functions.push({ name: line.match(/def\s+(\w+)/)[1], line: i + 1 });
                    }
                });
                
                stats.functions = functions;
                stats.classes = classes;
                
                return JSON.stringify(stats, null, 2);
            } catch (e) {
                return `Error: ${e.message}`;
            }
        }, 'Analyze code file. Params: {"path": "file.js"}');

        this.register('package_install', async ({ manager = 'npm', packages }) => {
            try {
                let cmd;
                if (manager === 'npm') {
                    cmd = `npm install ${packages.join(' ')}`;
                } else if (manager === 'pip') {
                    const py = resolvePython();
                    cmd = buildCmd([py.cmd, ...py.prefixArgs, '-m', 'pip', 'install', ...packages]);
                } else if (manager === 'cargo') {
                    cmd = `cargo add ${packages.join(' ')}`;
                } else {
                    return 'Error: Unsupported package manager. Use: npm, pip, cargo';
                }
                
                const result = execSync(cmd, { encoding: 'utf-8', timeout: 120000 });
                return result || 'Installed successfully';
            } catch (e) {
                return `Error: ${e.message}\n${e.stderr || ''}`;
            }
        }, 'Install packages. Params: {"manager": "npm|pip|cargo", "packages": ["express", "axios"]}');

        this.register('debug_trace', async ({ file, line }) => {
            try {
                const content = fs.readFileSync(file, 'utf-8');
                const lines = content.split('\n');
                const targetLine = lines[line - 1];
                
                // Show context around the line
                const start = Math.max(0, line - 5);
                const end = Math.min(lines.length, line + 5);
                const context = lines.slice(start, end).map((l, i) => {
                    const lineNum = start + i + 1;
                    const marker = lineNum === line ? '→' : ' ';
                    return `${marker} ${lineNum}: ${l}`;
                }).join('\n');
                
                return `Debug trace at ${file}:${line}\n\n${context}`;
            } catch (e) {
                return `Error: ${e.message}`;
            }
        }, 'Show debug trace with context. Params: {"file": "app.js", "line": 42}');

        this.register('internet_search', async ({ query, model = 'gateway-gemini-3-pro', effort = 'medium' }) => {
            try {
                const apiKey = process.env.UNLIMITED_API_KEY || process.env.ANTHROPIC_API_KEY;
                if (!apiKey) return 'Error: UNLIMITED_API_KEY or ANTHROPIC_API_KEY not set';

                const fetch = (await import('node-fetch')).default;
                const res = await fetch('https://unlimited.surf/api/search', {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${apiKey}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ query, model, effort })
                });

                if (!res.ok) return `Error: HTTP ${res.status}`;

                let results = [];
                let answer = '';
                const lines = (await res.text()).split('\n');
                
                for (const line of lines) {
                    if (!line.startsWith('data: ')) continue;
                    try {
                        const data = JSON.parse(line.slice(6));
                        if (data.results) results = data.results;
                        if (data.delta) answer += data.delta;
                    } catch {}
                }

                let output = answer || 'No answer generated';
                if (results.length) {
                    output += '\n\nSources:\n' + results.map((r, i) => 
                        `${i + 1}. ${r.title}\n   ${r.url}`
                    ).join('\n');
                }
                return sanitizeToolOutput(output);
            } catch (e) {
                return `Error: ${e.message}`;
            }
        }, 'Search internet. Params: {"query": "latest AI news", "model": "gateway-gemini-3-pro", "effort": "medium"}');
    }

    manualTree(dirPath, depth, ignore, currentDepth = 0, prefix = '') {
        if (currentDepth >= depth) return '';
        
        try {
            const entries = fs.readdirSync(dirPath, { withFileTypes: true });
            let result = '';
            
            entries.forEach((entry, i) => {
                if (ignore.some(pattern => entry.name.includes(pattern))) return;
                
                const isLast = i === entries.length - 1;
                const connector = isLast ? '└── ' : '├── ';
                result += `${prefix}${connector}${entry.name}\n`;
                
                if (entry.isDirectory()) {
                    const newPrefix = prefix + (isLast ? '    ' : '│   ');
                    result += this.manualTree(
                        path.join(dirPath, entry.name),
                        depth,
                        ignore,
                        currentDepth + 1,
                        newPrefix
                    );
                }
            });
            
            return result;
        } catch (e) {
            return '';
        }
    }

    setSubagentManager(manager) {
        this.subagentManager = manager;
    }
}

module.exports = { ToolRegistry };
