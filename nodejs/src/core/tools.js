const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { LSPClient } = require('./lsp');
const { DiffFormatter } = require('../ui/diff');

class ToolRegistry {
    constructor() {
        this.tools = new Map();
        this.lspClients = new Map();
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
            try {
                const result = execSync(`grep -r "${pattern}" ${searchPath} 2>/dev/null | head -50 || true`, {
                    encoding: 'utf-8',
                    maxBuffer: 1 * 1024 * 1024,
                    timeout: 5000
                });
                return result || 'No matches found';
            } catch (e) {
                return `Error: ${e.message}`;
            }
        }, 'Search in files. Params: {"pattern": "TODO", "path": "."}');

        this.register('find_files', async ({ pattern, path: searchPath = '.' }) => {
            try {
                const result = execSync(`find ${searchPath} -name "${pattern}" 2>/dev/null || true`, {
                    encoding: 'utf-8'
                });
                return result || 'No files found';
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
                
                const newContent = content.replace(old_str, new_str);
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
                    client = await this.initLSP(lang, process.cwd());
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
                    client = await this.initLSP(lang, process.cwd());
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
                    client = await this.initLSP(lang, process.cwd());
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
                    client = await this.initLSP(lang, process.cwd());
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
                    client = await this.initLSP(lang, process.cwd());
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
                    const tsClient = await this.initLSP('javascript', process.cwd());
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
        this.register('execute', async ({ file, args = '', stdin = '' }) => {
            try {
                const ext = file.split('.').pop();
                let cmd;
                
                // Detect language and build command
                if (ext === 'py') {
                    cmd = `python3 ${file} ${args}`;
                } else if (ext === 'js') {
                    cmd = `node ${file} ${args}`;
                } else if (ext === 'sh' || ext === 'bash') {
                    cmd = `bash ${file} ${args}`;
                } else if (ext === 'c') {
                    const out = file.replace('.c', '');
                    cmd = `gcc ${file} -o ${out} && ./${out} ${args}`;
                } else if (ext === 'cpp' || ext === 'cc' || ext === 'cxx') {
                    const out = file.replace(/\.(cpp|cc|cxx)$/, '');
                    cmd = `g++ ${file} -o ${out} && ./${out} ${args}`;
                } else if (ext === 'rs') {
                    const out = file.replace('.rs', '');
                    cmd = `rustc ${file} -o ${out} && ./${out} ${args}`;
                } else if (ext === 'go') {
                    cmd = `go run ${file} ${args}`;
                } else if (ext === 'java') {
                    const className = file.replace('.java', '');
                    cmd = `javac ${file} && java ${className} ${args}`;
                } else {
                    return `Error: Unsupported file type: ${ext}`;
                }
                
                const options = {
                    encoding: 'utf-8',
                    maxBuffer: 10 * 1024 * 1024,
                    timeout: 30000,
                    cwd: process.cwd()
                };
                
                // Add stdin if provided
                if (stdin) {
                    options.input = stdin;
                }
                
                const result = execSync(cmd, options);
                
                return result || '(no output)';
            } catch (e) {
                return `Error: ${e.message}\n${e.stderr || ''}`;
            }
        }, 'Compile and execute code file. Params: {"file": "main.py", "args": "arg1 arg2", "stdin": "input data"}');

        // Advanced debugging tools
        this.register('bash', async ({ command, working_dir }) => {
            try {
                const result = execSync(command, {
                    encoding: 'utf-8',
                    maxBuffer: 10 * 1024 * 1024,
                    timeout: 30000,
                    cwd: working_dir || process.cwd()
                });
                return result || '(no output)';
            } catch (e) {
                return `Error: ${e.message}\n${e.stderr || ''}`;
            }
        }, 'Execute bash command. Params: {"command": "ls -la", "working_dir": "/path"}');

        this.register('tree', async ({ path: dirPath = '.', depth = 2, ignore = [] }) => {
            try {
                const ignorePatterns = ['node_modules', '.git', 'dist', 'build', ...ignore];
                const ignoreArgs = ignorePatterns.map(p => `-I "${p}"`).join(' ');
                const cmd = `tree -L ${depth} ${ignoreArgs} ${dirPath}`;
                const result = execSync(cmd, { encoding: 'utf-8', timeout: 10000 });
                return result;
            } catch (e) {
                // Fallback if tree not installed
                return this.manualTree(dirPath, depth, ignorePatterns);
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
                    cmd = `git add -A && git commit -m "${message}"`;
                } else if (action === 'push') {
                    cmd = 'git push';
                } else if (action === 'pull') {
                    cmd = 'git pull';
                } else if (action === 'branch') {
                    cmd = branch ? `git checkout -b ${branch}` : 'git branch';
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
                    code_lines: lines.filter(l => l.trim() && !l.trim().startsWith('//')).length,
                    blank_lines: lines.filter(l => !l.trim()).length,
                    comment_lines: lines.filter(l => l.trim().startsWith('//')).length
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
                    cmd = `pip install ${packages.join(' ')}`;
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
