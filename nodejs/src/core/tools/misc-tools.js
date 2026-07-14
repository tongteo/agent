/**
 * @fileoverview Miscellaneous tools: execution, bash, git, tree, package management, etc.
 */

const fs = require('fs');
const path = require('path');
const { execSync, execFileSync } = require('child_process');
const { IS_WINDOWS, commandExists, resolvePython, buildCmd, checkCommandSafety } = require('./utils');

/**
 * Strip value of quotes and inline comments.
 * @param {string} raw - Raw value string
 * @returns {string} Cleaned value
 */
function stripValue(raw) {
    let v = raw.replace(/\s*#.*$/, '').trim();
    v = v.replace(/^(['"])(.*)\1$/, '$2');
    return v;
}

/**
 * Register miscellaneous execution and utility tools.
 * @param {import('./index').ToolRegistry} registry - Tool registry instance
 */
function registerMiscTools(registry) {
    // --- Execute code file ---
    registry.register('execute',
        async ({ file, command, args = '', stdin = '' }) => {
            if (command && !file) {
                return registry.tools.get('bash').fn({ command });
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
                    cwd: registry.session?.workingDir || process.cwd(),
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
        },
        'Compile and execute code file. Params: {"file": "main.py", "args": "arg1 arg2", "stdin": "input data"}'
    );

    // --- Bash/shell command ---
    registry.register('bash',
        async ({ command, working_dir }) => {
            const trimmed = command.trim();
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
            // Defense-in-depth: block destructive commands that slip past the validator
            const safety = checkCommandSafety(trimmed);
            if (!safety.safe) {
                return `Error: Command blocked — ${safety.reason}`;
            }
            try {
                const shellOpt = IS_WINDOWS ? (commandExists('bash') ? 'bash' : true) : '/bin/sh';
                const result = execSync(command, {
                    shell: shellOpt,
                    encoding: 'utf-8',
                    maxBuffer: 10 * 1024 * 1024,
                    timeout: 30000,
                    env: process.env,
                    cwd: working_dir || registry.session?.workingDir || process.cwd()
                });
                return result || '(no output)';
            } catch (e) {
                return `Error: ${e.message}\n${e.stderr || ''}`;
            }
        },
        'Execute shell command. Params: {"command": "ls -la", "working_dir": "/path"}'
    );

    // --- Directory tree ---
    registry.register('tree',
        async ({ path: dirPath = '.', depth = 2, ignore = [] }) => {
            const ignorePatterns = ['node_modules', '.git', 'dist', 'build', ...ignore];
            try {
                return registry.manualTree(dirPath, depth, ignorePatterns) || '(empty)';
            } catch (e) {
                return `Error: ${e.message}`;
            }
        },
        'Show directory tree. Params: {"path": ".", "depth": 2, "ignore": ["tmp"]}'
    );

    // --- Git operations ---
    registry.register('git',
        async ({ action, message, branch }) => {
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
                            cwd: registry.session?.workingDir || process.cwd()
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
        },
        'Git operations. Params: {"action": "status|diff|log|commit|push|pull|branch", "message": "...", "branch": "..."}'
    );

    // --- Analyze code file ---
    registry.register('analyze_code',
        async ({ path: filePath }) => {
            try {
                const content = fs.readFileSync(filePath, 'utf-8');
                const lines = content.split('\n');
                const ext = filePath.split('.').pop();

                const isComment = (l) => {
                    const t = l.trim();
                    return t.startsWith('//') || t.startsWith('#') || t.startsWith('*') || t.startsWith('/*');
                };
                const stats = {
                    file: filePath,
                    language: ext,
                    total_lines: lines.length,
                    code_lines: lines.filter(l => l.trim() && !isComment(l)).length,
                    blank_lines: lines.filter(l => !l.trim()).length,
                    comment_lines: lines.filter(l => isComment(l)).length
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
        },
        'Analyze code file. Params: {"path": "file.js"}'
    );

    // --- Package install ---
    registry.register('package_install',
        async ({ manager = 'npm', packages }) => {
            try {
                if (!packages || !Array.isArray(packages) || packages.length === 0) {
                    return 'Error: packages must be a non-empty array';
                }
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
        },
        'Install packages. Params: {"manager": "npm|pip|cargo", "packages": ["express", "axios"]}'
    );

    // --- Debug trace ---
    registry.register('debug_trace',
        async ({ file, line }) => {
            try {
                const content = fs.readFileSync(file, 'utf-8');
                const lines = content.split('\n');
                const start = Math.max(0, line - 5);
                const end = Math.min(lines.length, line + 5);
                const context = lines.slice(start, end).map((l, i) => {
                    const lineNum = start + i + 1;
                    const marker = lineNum === line ? '\u2192' : ' ';
                    return `${marker} ${lineNum}: ${l}`;
                }).join('\n');

                return `Debug trace at ${file}:${line}\n\n${context}`;
            } catch (e) {
                return `Error: ${e.message}`;
            }
        },
        'Show debug trace with context. Params: {"file": "app.js", "line": 42}'
    );

    // Cache fetch import for internet_search
    let _fetch;
    async function getFetch() {
        if (!_fetch) {
            const mod = await import('node-fetch');
            _fetch = mod.default || mod;
        }
        return _fetch;
    }

    // --- Internet search ---
    registry.register('internet_search',
        async ({ query }) => {
            try {
                const fetch = await getFetch();
                const res = await fetch(
                    `https://searx.nousresearch.com/search?q=${encodeURIComponent(query)}&format=json`,
                    {
                        headers: { 'User-Agent': 'agent-cli/1.0' },
                        signal: AbortSignal.timeout(10000)
                    }
                );
                if (!res.ok) return `Search unavailable (HTTP ${res.status})`;
                const data = await res.json();
                if (!data.results?.length) return 'No results found.';
                return data.results.slice(0, 5).map((r, i) =>
                    `${i + 1}. ${r.title}\n   ${r.url}\n   ${(r.content || '').slice(0, 200)}`
                ).join('\n');
            } catch (e) {
                return `Search error: ${e.message}`;
            }
        },
        'Search internet. Params: {"query": "latest AI news"}'
    );
}

module.exports = { registerMiscTools };
