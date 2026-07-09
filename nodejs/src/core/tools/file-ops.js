/**
 * @fileoverview File operation tools for the agent.
 * Provides read, write, search, and patch operations on the filesystem.
 */

const fs = require('fs');
const path = require('path');
const { IS_WINDOWS, sanitizeToolOutput } = require('./utils');
const { DiffFormatter } = require('../../ui/diff');

/**
 * Register file operation tools on the given ToolRegistry.
 * @param {import('./index').ToolRegistry} registry - Tool registry instance
 */
function registerFileOps(registry) {
    // --- Read file ---
    registry.register('read_file',
        async ({ path: filePath }) => {
            try {
                return fs.readFileSync(filePath, 'utf-8');
            } catch (e) {
                return `Error: ${e.message}`;
            }
        },
        'Read file content. Params: {"path": "file.txt"}'
    );

    // --- Write file ---
    registry.register('write_file',
        async ({ path: filePath, content }) => {
            try {
                // Resolve relative paths against session workingDir (not process.cwd())
                const cwd = registry.session?.workingDir || process.cwd();
                // Expand ~ to home directory
                const homedir = require('os').homedir();
                const expandedPath = filePath.startsWith('~/') ? homedir + filePath.slice(1) : filePath;
                const resolvedPath = path.isAbsolute(expandedPath) ? expandedPath : path.resolve(cwd, expandedPath);

                // Create parent directories if they don't exist
                const parentDir = path.dirname(resolvedPath);
                if (!fs.existsSync(parentDir)) {
                    fs.mkdirSync(parentDir, { recursive: true });
                }

                const exists = fs.existsSync(resolvedPath);
                const oldContent = exists ? fs.readFileSync(resolvedPath, 'utf-8') : null;

                // Fix common JSON escape issues in C/C++ code:
                // Models often output \n (JSON newline) instead of \\n (literal \n)
                // inside C string literals. Detect and fix: real newlines inside
                // C-style "..." delimiters that aren't at statement boundaries.
                let processedContent = content;
                if (resolvedPath.match(/\.(c|cpp|h|hpp|js|ts|go|rs|java|py)$/i)) {
                    processedContent = content.replace(
                        /"([^"\\]*(?:\\.[^"\\]*)*)"/g,
                        (cStr) => cStr.replace(/\n/g, '\\n')
                    );
                }

                fs.writeFileSync(resolvedPath, processedContent);

                if (exists) {
                    const diff = DiffFormatter.formatDiff(oldContent, processedContent, resolvedPath);
                    return diff || 'File written successfully (no changes)';
                } else {
                    return DiffFormatter.formatCreate(processedContent, resolvedPath);
                }
            } catch (e) {
                return `Error: ${e.message}`;
            }
        },
        'Write to file. Params: {"path": "file.txt", "content": "..."}'
    );

    // --- List directory ---
    registry.register('list_dir',
        async ({ path: dirPath = '.' }) => {
            try {
                const files = fs.readdirSync(dirPath);
                return files.join('\n');
            } catch (e) {
                return `Error: ${e.message}`;
            }
        },
        'List directory. Params: {"path": "."}'
    );

    // --- Grep/search inside files ---
    registry.register('grep',
        async ({ pattern, path: searchPath = '.' }) => {
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
        },
        'Search in files. Params: {"pattern": "TODO", "path": "."}'
    );

    // --- Find files by name ---
    registry.register('find_files',
        async ({ pattern, path: searchPath = '.' }) => {
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
        },
        'Find files by name. Params: {"pattern": "*.js", "path": "."}'
    );

    // --- String replace in file ---
    registry.register('str_replace',
        async ({ path: filePath, old_str, new_str }) => {
            try {
                const content = fs.readFileSync(filePath, 'utf-8');
                const escapedOld = old_str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                const occurrences = (content.match(new RegExp(escapedOld, 'g')) || []).length;

                if (occurrences === 0) return 'Error: old_str not found';
                if (occurrences > 1) return `Error: old_str found ${occurrences} times (must be unique)`;

                const idx = content.indexOf(old_str);
                const newContent = content.slice(0, idx) + new_str + content.slice(idx + old_str.length);
                fs.writeFileSync(filePath, newContent);

                const diff = DiffFormatter.formatDiff(content, newContent, filePath);
                return diff || 'Replacement successful';
            } catch (e) {
                return `Error: ${e.message}`;
            }
        },
        'Replace text in file. Params: {"path": "file.txt", "old_str": "old", "new_str": "new"}'
    );

    // --- Insert at line ---
    registry.register('insert_at_line',
        async ({ path: filePath, line, content }) => {
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
        },
        'Insert content at line. Params: {"path": "file.txt", "line": 5, "content": "new line"}'
    );

    // --- Append to file ---
    registry.register('append',
        async ({ path: filePath, content }) => {
            try {
                fs.appendFileSync(filePath, content);
                return 'Content appended';
            } catch (e) {
                return `Error: ${e.message}`;
            }
        },
        'Append to file. Params: {"path": "file.txt", "content": "..."}'
    );

    // --- Read line range ---
    registry.register('read_lines',
        async ({ path: filePath, start, end }) => {
            try {
                const lines = fs.readFileSync(filePath, 'utf-8').split('\n');
                const startIdx = start < 0 ? lines.length + start : start - 1;
                const endIdx = end < 0 ? lines.length + end + 1 : end;

                if (startIdx < 0 || endIdx > lines.length) return 'Error: line range out of bounds';

                return lines.slice(startIdx, endIdx).join('\n');
            } catch (e) {
                return `Error: ${e.message}`;
            }
        },
        'Read line range. Params: {"path": "file.txt", "start": 1, "end": 10}'
    );
}

module.exports = { registerFileOps };
