const chalk = require('chalk');
const fs = require('fs');
const path = require('path');
const { SessionManager } = require('./core/session');
const { MessageHandler } = require('./core/message');
const { CommandExecutor } = require('./commands/executor');
const { extractCommands } = require('./commands/parser');
const { isDangerous, isInteractive } = require('./commands/validator');
const { formatOutput, formatMath, renderMarkdown } = require('./ui/formatter');
const { PromptManager } = require('./ui/prompt');
const { ToolRegistry } = require('./core/tools');
const { AgentPrompt, ToolParser } = require('./core/agent');
const { SubagentManager } = require('./core/subagent');
const { autoFixCFile } = require('./core/auto-fix');
const { startSpinner, stopSpinner, withSigint, createStreamTimeout, hasToolCall, stripToolCalls } = require('./core/stream-utils');

class ChatBot {
    constructor(apiKey, model = '', agentMode = false, enableSubagents = true, autoExecute = true) {
        this.apiKey = apiKey;
        this.modelName = model;
        this.agentMode = agentMode;
        this.autoExecute = autoExecute;
        this.session = new SessionManager();
        this.prompt = new PromptManager();
        this.model = null;
        this.messageHandler = null;
        this.executor = null;
        this.tools = agentMode ? new ToolRegistry(this.session) : null;
        this.subagentManager = (agentMode && enableSubagents) ? new SubagentManager(apiKey, model, process.cwd()) : null;
        this._lastHandledResponse = null;
        /** @type {AbortController|null} */
        this._abortController = null;
    }

    async init() {
        this.session.load();

        const openaiKey = process.env.OPENAI_API_KEY;
        if (openaiKey) {
            const { OpenAIAdapter } = require('./models/openai-adapter');
            this.model = new OpenAIAdapter();
            // Enable tools for agent mode
            if (this.agentMode && this.tools) {
                this.model.enableTools(this.tools.getToolSchemas());
            }
        } else {
            throw new Error('No provider configured. Set OPENAI_API_KEY in .env');
        }
        await this.model.init();

        const agentPrompt = this.agentMode
            ? (this.model.tools
                ? 'You are an AI agent. Use the provided tools to complete tasks. After all tasks are done, respond briefly.'
                : AgentPrompt.getSystemPrompt(this.tools))
            : null;
        this.messageHandler = new MessageHandler(this.model, this.session, agentPrompt, {
            toolRegistry: this.tools
        });
        this.executor = new CommandExecutor(this.session);
        
        if (this.agentMode && this.subagentManager) {
            this.tools.setSubagentManager(this.subagentManager);
        }

        this._printHeader();
    }

    _printHeader() {
        const modelName = this.model.model || 'unknown';
        const mode = this.agentMode ? 'agent' : 'chat';
        const modeColor = this.agentMode ? chalk.magentaBright : chalk.cyanBright;
        const cwd = process.cwd().replace(process.env.HOME, '~');

        process.stdout.write(
            '\n' +
            chalk.bold.white('  agent-cli') +
            chalk.dim('  model ') + chalk.cyan(modelName) +
            chalk.dim('  mode ') + modeColor(mode) +
            chalk.dim('  ' + cwd) + '\n' +
            chalk.dim('  exit  clear  /cache  /model <name>  [Tab]\n') +
            '\n'
        );
    }

    _printUsage() {
        const u = this.model?.lastUsage;
        if (!u) return;
        // KV cache hit — skip API entirely
        if (u._cacheHit) {
            process.stdout.write(chalk.dim('  ') + chalk.green('\u26a1 KV cache hit') + chalk.dim(' (no API call)\n'));
            return;
        }
        const apiCached = u.prompt_tokens_details?.cached_tokens ?? u.cache_read_input_tokens ?? 0;
        const kvStats = this.model?.getCacheStatsString?.() || '';
        const parts = ['\u2191' + u.prompt_tokens, apiCached ? chalk.green('\u26a1' + apiCached) : null, '\u2193' + u.completion_tokens].filter(Boolean);
        process.stdout.write(chalk.dim(`  ${parts.join(' ')}`));
        if (kvStats) process.stdout.write(chalk.dim(`  ${kvStats}`));
        process.stdout.write('\n');
    }

    async clearChat() {
        this.model.reset();
        this.messageHandler.reset();
        this.session.reset();
        this.model.clearCache?.();
        process.stdout.write('\x1b[2J\x1b[H'); // clear screen
        this._printHeader();
    }

    async chatOnce(query) {
        await this.messageHandler.send(query);
        let full = '';
        await this.messageHandler.stream((chunk) => { full += chunk; });
        if (this.agentMode) await this.handleToolCalls();
        return full;
    }

    async chat() {
        this.prompt.init();

        while (true) {
            const input = await this.prompt.ask(chalk.bold.green('\u276f '), this._getCompletions());
            const msg = input.trim();

            if (msg.toLowerCase() === 'exit') {
                process.stdout.write(chalk.dim('\n  bye\n\n'));
                this.prompt.close();
                process.exit(0);
            }

            if (msg.toLowerCase() === 'clear') {
                await this.clearChat();
                continue;
            }

            if (msg.startsWith('/model')) {
                await this._handleModelCommand(msg);
                continue;
            }

            if (msg === '/think' || msg === '/think on' || msg === '/think off') {
                const model = this.messageHandler.model;
                if (typeof model.showThinking === 'undefined') {
                    console.log('Current model does not support thinking toggle\n');
                } else {
                    model.showThinking = msg !== '/think off';
                    console.log(`Thinking display: ${model.showThinking ? 'ON' : 'OFF'}\n`);
                }
                continue;
            }
            if (msg === '/cache' || msg === '/cache clear') {
                if (msg === '/cache clear') {
                    this.model.clearCache?.();
                    console.log('KV cache cleared\n');
                } else {
                    const stats = this.model?.getCacheStatsString?.();
                    console.log(stats || 'KV cache: disabled\n');
                }
                continue;
            }

            if (msg) {
                // Cancel any pending abort controller from previous turn
                if (this._abortController) {
                    this._abortController.abort();
                }
                this._abortController = new AbortController();
                const signal = this._abortController.signal;

                await this.messageHandler.send(msg);
                
                // Spinner while waiting
                const interval = startSpinner();
                let full = '';
                let aborted = false;
                const cleanupSigint = withSigint(() => {
                    aborted = true;
                    this.model.abort?.();
                }, this.prompt);
                try {
                    // Check if this turn was aborted before streaming starts
                    if (signal.aborted) {
                        aborted = true;
                    } else {
                        await this.messageHandler.stream((chunk) => {
                            if (signal.aborted) {
                                this.model.abort?.();
                                aborted = true;
                            }
                            if (!aborted) full += chunk;
                        });
                    }
                } finally {
                    stopSpinner(interval);
                    cleanupSigint();
                }

                if (aborted) {
                    process.stdout.write(chalk.dim('  \u21a9 interrupted\n\n'));
                    continue;
                }

                // Detect JSON-format tool calls (write_file\n{...}, bash\n{...})
                const hasToolCallFlag = hasToolCall(full, ToolParser.TOOL_NAMES, this.model.pendingToolCalls);
                if (full.trim()) {
                    // Show conversational text even when tool call XML/JSON is present
                    let displayText = full.trim();
                    if (hasToolCallFlag) {
                        displayText = stripToolCalls(full, ToolParser.TOOL_NAMES);
                    }
                    if (displayText && displayText !== '(no response)') {
                        process.stdout.write(renderMarkdown(displayText, this.agentMode) + '\n');
                    }
                }
                this._printUsage();
                console.log('');
                
                // Agent mode: handle tool calls and commands
                if (this.agentMode) {
                    await this.handleToolCalls();
                    await this.handleCommands();
                }
            }
        }
    }

    /**
     * Get the content of the last assistant message in history.
     * @returns {string|null}
     */
    async getLastResponse() {
        if (!this.model.messages || this.model.messages.length === 0) return null;
        const last = this.model.messages[this.model.messages.length - 1];
        return last?.content || null;
    }

    /**
     * Auto-fix common C compilation errors in a source file.
     * Delegates to auto-fix module.
     * @param {string} filePath - Path to the .c file
     * @param {string} compileError - The gcc error output
     * @returns {string} Description of what was fixed, or empty string if no fix needed
     */
    _autoFixCFile(filePath, compileError) {
        return autoFixCFile(filePath, compileError);
    }

    /**
     * Analyze tool execution results and generate smart feedback.
     * Detects write_file→compile_fail→write_file loops, injects fix guidance.
     */
    _analyzeToolResults(results) {
        let smartFeedback = '';

        // Check for write_file on a .c/.cpp/.py/.js file right after a compile fail
        for (let i = 0; i < results.length; i++) {
            const r = results[i];
            if (!r) continue;

            // Detect: tool=write_file for a source file, right after a gcc/clang error
            const isSrcWrite = r.tool === 'write_file' && r.params?.path?.match(/\.(c|cpp|py|js|ts|go|rs|java)$/i);
            if (isSrcWrite) {
                // Look backward for gcc errors on the same file
                for (let j = Math.max(0, i - 3); j < i; j++) {
                    const prev = results[j];
                    if (prev && prev.tool === 'bash' && prev.result?.match(/(gcc:|clang:|error:|compilation terminated)/i)) {
                        const srcPath = r.params.path;
                        smartFeedback += `\n[SMART FIX] "${srcPath}" failed to compile before. Instead of rewriting the whole file:\n`
                            + `1. read_file "${srcPath}" — examine the code around the error lines\n`
                            + `2. str_replace — fix only the specific syntax issue (missing brace, semicolon, etc.)\n`
                            + `3. bash — recompile with gcc\n`
                            + `Do NOT write_file the entire file again — use str_replace for targeted fixes.\n`;
                    }
                }
            }

            // Detect write_file on same path twice (model rewriting without fixing root cause)
            if (r.tool === 'write_file' && r.params?.path) {
                this._rewrittenFiles = this._rewrittenFiles || new Map();
                const path = r.params.path;
                const count = (this._rewrittenFiles.get(path) || 0) + 1;
                this._rewrittenFiles.set(path, count);
                if (count >= 3) {
                    smartFeedback += `\n[WRITE LOOP] You have rewritten "${path}" ${count} times.`
                        + ` STOP rewriting. Read the file first, identify the exact syntax error,`
                        + ` then use str_replace to fix ONLY the broken lines.\n`;
                }
            }
        }
        return smartFeedback;
    }

    /**
     * Compress a tool result for storage in message history.
     * Keeps full output for errors (model needs details to fix),
     * compresses successful outputs to save context tokens.
     * @param {string} tool - Tool name
     * @param {Object} params - Tool parameters
     * @param {string} result - Full tool result
     * @returns {string} Compressed result for message history
     */
    _compressToolResult(tool, params, result) {
        if (!result) return result;
        // Errors: keep full — model needs details to fix
        if (result.startsWith('Error:') || result.startsWith('[COMPILATION FAILED]') || result.startsWith('[RUNTIME ERROR]')) {
            return result.length > 2000 ? result.substring(0, 2000) + '...(truncated error)' : result;
        }
        // read_file: just report what was read, not the content
        if (tool === 'read_file') {
            const lines = (result.match(/\n/g) || []).length + 1;
            const preview = result.split('\n').slice(0, 3).join(' ');
            return `[read_file: ${params.path || '?'} — ${lines} lines]\nPreview: ${preview.slice(0, 300)}\n(Use read_file offset/limit for specific sections)`;
        }
        // list_dir / tree: keep compact
        if (tool === 'list_dir' || tool === 'tree') {
            return result.length > 800 ? result.substring(0, 800) + '...' : result;
        }
        // write_file / str_replace: keep short diff
        if (tool === 'write_file' || tool === 'str_replace') {
            return result.length > 600 ? result.substring(0, 600) + '...' : result;
        }
        // bash/execute success: keep first lines + summary
        if (tool === 'bash' || tool === 'execute') {
            if (result.length > 1000) {
                const lines = result.split('\n');
                const head = lines.slice(0, 10).join('\n');
                const tail = lines.slice(-3).join('\n');
                return `${head}\n... (${lines.length - 13} lines omitted) ...\n${tail}`;
            }
            return result;
        }
        // Default: truncate long results
        if (result.length > 1500) {
            return result.substring(0, 1500) + '...(truncated)';
        }
        return result;
    }

    async handleToolCalls(maxIterations = 200) {
        let iteration = 0;
        /** Track repeated tool+params to detect loops */
        const failureCache = new Map();
        /** Track source files rewritten (write_file) after compile failure */
        this._rewrittenFiles = this._rewrittenFiles || new Map();
        /** Track which .c/.cpp files got gcc errors this session */
        this._failedCompiles = this._failedCompiles || new Map();
        /** Track whether any tool calls were processed (to prevent duplicate handleCommands) */
        this._handledToolCalls = false;
        /** Rate limit cooldown: increases on429, resets on success (ms) */
        let rateLimitCooldown = 0;
        /** Overall timeout: prevent infinite loops (10 minutes) */
        const overallDeadline = Date.now() + 600_000;

        while (iteration < maxIterations) {
            // Check overall timeout
            if (Date.now() > overallDeadline) {
                console.log(chalk.yellow('\n⚠️  Overall timeout reached (10 min) — stopping agent loop\n'));
                break;
            }
            // Rate limit cooldown between iterations
            if (rateLimitCooldown > 0) {
                process.stderr.write(`  ⏳ Rate limit cooldown: ${rateLimitCooldown / 1000}s\n`);
                await new Promise(r => setTimeout(r, rateLimitCooldown));
                rateLimitCooldown = 0; // reset, will re-increase if next call also429s
            }
            // Prefer native function calling (OpenRouter), fallback to XML parsing
            let toolCalls;
            if (this.model.pendingToolCalls?.length) {
                toolCalls = this.model.pendingToolCalls.map(tc => ({
                    tool: tc.name,
                    params: (() => { try { return JSON.parse(tc.arguments); } catch { return {}; } })(),
                    id: tc.id
                }));
                this.model.pendingToolCalls = null;
            } else {
                const lastResponse = await this.getLastResponse();
                if (!lastResponse) break;
                toolCalls = ToolParser.parse(lastResponse).map(tc => ({ ...tc, id: null }));
            }

            // When --no-auto-execute: block execute/bash tool calls entirely
            // (IntentParser is already skipped above, but model may still output them)
            if (!this.autoExecute) {
                toolCalls = toolCalls.filter(tc => tc.tool !== 'execute' && tc.tool !== 'bash');
                if (toolCalls.length === 0) {
                    this._handledToolCalls = true; // prevent handleCommands fallback
                    break;
                }
            }

            if (toolCalls.length === 0) break;
            this._handledToolCalls = true;

            const results = [];
            // Sequential execution — avoids race conditions where a tool
            // depends on a previous tool's side effect (e.g. write_file → execute)
            for (const { tool, params, id } of toolCalls) {
                const label = params.path || params.command || params.query || '';
                process.stdout.write(chalk.dim(`  \u2699  ${tool}${label ? ' ' + label : ''} `));
                const spin = startSpinner();
                try {
                    // Detect heredoc file writes: cat << 'EOF' > filename
                    // The model often uses this instead of write_file, but \n in C code
                    // gets double-escaped and breaks the heredoc. Convert to write_file.
                    let resolvedTool = tool;
                    let resolvedParams = params;
                    if (tool === 'bash' && typeof params.command === 'string') {
                        const heredocMatch = params.command.match(/^cat\s+<<\s+'?(\w+)'?\s*>\s*(.+)$/m);
                        if (heredocMatch) {
                            const delim = heredocMatch[1];
                            const filePath = heredocMatch[2].replace(/\s+$/, '');
                            // Expand ~ in file path
                            const homedir = require('os').homedir();
                            const expandedFilePath = filePath.startsWith('~/') ? homedir + filePath.slice(1) : filePath;
                            let resolvedDir = process.cwd();
                            if (params.working_dir) {
                                resolvedDir = params.working_dir;
                            } else if (this.session?.workingDir) {
                                resolvedDir = this.session.workingDir;
                            }
                            const resolvedFilePath = path.isAbsolute(expandedFilePath) ? expandedFilePath : path.resolve(resolvedDir, expandedFilePath);
                            const firstNl = params.command.indexOf('\n');
                            if (firstNl >= 0) {
                                const afterFirstLine = params.command.substring(firstNl + 1);
                                const endMarker = '\n' + delim;
                                const endIdx = afterFirstLine.lastIndexOf(endMarker);
                                if (endIdx > 0) {
                                    const fileContent = afterFirstLine.substring(0, endIdx);
                                    resolvedTool = 'write_file';
                                    resolvedParams = { path: resolvedFilePath, content: fileContent };
                                } else {
                                    // No EOF marker found — still extract content up to last \n
                                    // This handles truncated heredocs (parser broke at embedded quotes)
                                    const truncatedContent = afterFirstLine.replace(/\n\s*$/, '');
                                    if (truncatedContent.length > 10) {
                                        resolvedTool = 'write_file';
                                        resolvedParams = { path: resolvedFilePath, content: truncatedContent };
                                    }
                                }
                            }
                        }
                    }
                    let result = await this.tools.execute(resolvedTool, resolvedParams);
                    stopSpinner(spin);
                    process.stdout.write(`
\x1b[K  ${chalk.green('\u2713')} ${chalk.bold(resolvedTool)}${label ? chalk.dim(' ' + label) : ''}\n`);

                    const displayTools = ['execute', 'bash', 'tree', 'git', 'analyze_code', 'debug_trace'];
                    if (displayTools.includes(tool) && result && !result.startsWith('Error:')) {
                        const lines = result.trim().split('\n').slice(0, 20);
                        process.stdout.write(chalk.dim(lines.join('\n')) + '\n');
                    }

                    // Display code view for file-write tools (DiffFormatter output)
                    const codeViewTools = ['write_file', 'str_replace'];
                    if (codeViewTools.includes(resolvedTool) && result && !result.startsWith('Error:')) {
                        process.stdout.write(result + '\n');
                    }

                    // Track last written file for subsequent "compile and run" shortcut
                    if (resolvedTool === 'write_file' && resolvedParams?.path && !result?.startsWith('Error:')) {
                        this._lastWrittenFile = resolvedParams.path;
                    }

                    // Mark compilation/runtime failures strongly
                    const isCompileFail = result && (
                        result.startsWith('gcc:') || result.startsWith('g++:') ||
                        result.includes('error:') || result.includes('warning: here-document') ||
                        result.includes('Traceback') || result.includes('SyntaxError') ||
                        result.includes('IndentationError') || result.includes('NameError') ||
                        result.includes('TypeError') || result.includes('ModuleNotFoundError')
                    );
                    if (isCompileFail) {
                        const prefix = result.includes('Traceback') ? '[RUNTIME ERROR]' : '[COMPILATION FAILED]';
                        result = prefix + ' The code did not compile/run correctly. The error above is real — do not claim success.\n' + result;
                    }

                    // Track compile/runtime failures per source file
                    if (tool === 'bash' || tool === 'execute') {
                        const cmd = params.command || '';
                        const srcMatch = cmd.match(/(?:gcc|g\+\+|python3?)\s+(?:\S+\s+)*['"]?([\w./]+\.[\w]+)['"]?/i);
                        if (srcMatch && (result?.startsWith('gcc:') || result?.startsWith('g++:') || result?.includes('error:') || result?.includes('Traceback'))) {
                            const srcPath = srcMatch[1];
                            const prevFails = (this._failedCompiles.get(srcPath) || 0) + 1;
                            this._failedCompiles.set(srcPath, prevFails);
                        }
                    }

                    // Detect loops: same tool + same params failing repeatedly
                    const isError = result && (result.startsWith('Error:') || result.startsWith('gcc:') || result.includes('error:'));
                    if (isError) {
                        const hash = `${tool}:${JSON.stringify(params)}`;
                        const prev = (failureCache.get(hash) || 0) + 1;
                        failureCache.set(hash, prev);
                        if (prev >= 2) {
                            // Same tool+params failed twice — force model to read+analyze instead of retrying
                            const augmentedResult = `[LOOP DETECTED] This is attempt #${prev + 1} with the same params. STOP retrying. Read the file around the error line, analyze the root cause, fix with str_replace, then re-run.\nError: ${result}`;
                            results.push({ tool, id, result: augmentedResult, compressed: augmentedResult });
                            continue;
                        }
                    }

                    const truncated = result.length > 3000 ? result.substring(0, 3000) + '...(truncated)' : result;
                    const compressed = this._compressToolResult(tool, params, truncated);
                    results.push({ tool, params, id, result: truncated, compressed });
                } catch (e) {
                    stopSpinner(spin);
                    process.stdout.write(`\r\x1b[K  ${chalk.red('\u2717')} ${chalk.bold(tool)}${label ? chalk.dim(' ' + label) : ''}: ${e.message}\n`);
                    results.push({ tool, params, id, result: `Error: ${e.message}`, compressed: `Error: ${e.message}` });
                }
            }

            // For function calling: push tool role messages; for XML: send as user message
            if (results[0]?.id) {
                for (const { tool, id, compressed } of results) {
                    this.model.messages.push({ role: 'tool', tool_call_id: id, name: tool, content: compressed || '' });
                }
                await this.messageHandler.send(null, false); // trigger stream without adding user msg
            } else {
                // Include original user request so model knows what remains
                const origUserMsg = this.model.messages.find(m =>
                    m.role === 'user' && m.content && !m.content.startsWith('[Tool Results]') && !m.content.startsWith('[Command Results]')
                );
                const origHint = origUserMsg ? `\nOriginal request: ${origUserMsg.content.substring(0, 200)}` : '';

                // Run smart analysis on results to detect write→compile→write loops
                let smartAnalysis = this._analyzeToolResults(results);

                // Also check if we're rewriting a file that failed compilation
                const lastWrite = results.filter(r => r.tool === 'write_file').pop();
                if (lastWrite && lastWrite.params?.path) {
                    const compileFails = this._failedCompiles.get(lastWrite.params.path) || 0;
                    if (compileFails >= 1) {
                        smartAnalysis += `\n[NOTE] "${lastWrite.params.path}" previously failed to compile (${compileFails}x). `
                            + `If you just rewrote it again, you may have introduced the same bugs. `
                            + `Use read_file to examine the code, identify the exact error, and use str_replace to fix only the broken parts.\n`;
                    }
                }

                // Auto-fix: when same file keeps failing to compile, try to fix it automatically
                for (const [srcPath, failCount] of this._failedCompiles) {
                    if (failCount >= 2 && fs.existsSync(srcPath)) {
                        const fixResult = this._autoFixCFile(srcPath, '');
                        if (fixResult) {
                            smartAnalysis += `\n[AUTO-FIX] ${fixResult}\n`;
                            // Clear the counter so we don't keep re-fixing
                            this._failedCompiles.set(srcPath, 0);
                        }
                    }
                }

                const feedbackHint = this.autoExecute
                    ? 'If the user\'s original request needs more steps, continue. Otherwise respond briefly to confirm.'
                    : 'Respond briefly to confirm what was done. Do NOT auto-run additional commands.';
                const feedback = `[Tool Results]\n${results.map(r => `[${r.tool}] ${r.compressed || r.result}`).join('\n')}${origHint}${smartAnalysis}\n\n${feedbackHint}`;
                await this.messageHandler.send(feedback, false);
            }
            
            // Stream response
            const streamInterval = startSpinner();
            let full = '';
            let aborted = false;
            const streamTimeout = createStreamTimeout(300000, () => {
                aborted = true;
                this.model.abort?.();
            });
            const cleanupSigint = withSigint(() => { aborted = true; this.model.abort?.(); }, this.prompt);
            try {
                await this.messageHandler.stream((chunk) => { full += chunk; });
            } finally {
                clearTimeout(streamTimeout);
                stopSpinner(streamInterval);
                cleanupSigint();
            }
            // Detect rate limit from error output (messageHandler.stream catches internally)
            if (full && (full.includes('429') || full.toLowerCase().includes('rate limit'))) {
                rateLimitCooldown = Math.min(rateLimitCooldown + 5000, 60_000); // +5s, max60s
            } else {
                rateLimitCooldown = 0;
            }

            // Display conversational text — show text before tool calls (same as chat())
            // so the user always sees the model's commentary between tool executions
            const hasToolCallFlag = hasToolCall(full, ToolParser.TOOL_NAMES);
            if (full.trim() && full.trim() !== '(no response)') {
                let displayText = full.trim();
                if (hasToolCallFlag) {
                    displayText = stripToolCalls(full, ToolParser.TOOL_NAMES);
                }
                if (displayText && displayText !== '(no response)') {
                    // Post-loop verification: only when model gives final answer (no tool calls)
                    // and claims success despite previous compilation failures
                    if (!hasToolCallFlag && displayText.match(/(?:thành công|success|hoàn tất|done|completed|finished)/i)) {
                        const lastResults = results || [];
                        const hasCompileFail = lastResults.some(r =>
                            r.result && r.result.startsWith('[COMPILATION FAILED]')
                        );
                        if (hasCompileFail) {
                            const forcedMsg = '[SYSTEM] You reported success, but the code did NOT compile. '
                                + 'Read the compilation error above carefully. '
                                + 'Use read_file to examine the source file, identify the exact syntax issue, '
                                + 'then use str_replace to fix only the broken lines. '
                                + 'Do NOT rewrite the whole file and do NOT claim success until gcc exits without errors.';
                            await this.messageHandler.send(forcedMsg, false);
                            iteration++;
                            continue;
                        }
                    }
                    process.stdout.write(renderMarkdown(displayText, this.agentMode) + '\n');
                }
            }
            console.log('');

            if (aborted) break;
            iteration++;
        }
        
        if (iteration >= maxIterations) {
            console.log(chalk.yellow(`\n\u26a0\ufe0f  Reached maximum iterations (${maxIterations})\n`));
        }
    }

    async handleCommands() {
        // If handleToolCalls already processed tool calls this cycle, skip command extraction
        // to prevent duplicate execution (the same model response may contain both tool calls and bash blocks)
        if (this._handledToolCalls) {
            this._handledToolCalls = false;
            return;
        }
        const maxIterations = 200;
        let iteration = 0;

        while (iteration < maxIterations) {
            const lastResponse = await this.getLastResponse();
            if (!lastResponse || lastResponse === this._lastHandledResponse) return;

            // Skip command extraction if response contains code blocks
            // (likely a model explanation, not shell commands to execute)
            if (lastResponse.match(/```(?:c|cpp|python|js|ts|java|go|rs|xml|json|yaml|yml|sql|html|css)\b/i)) {
                return;
            }

            const commands = extractCommands(lastResponse);
            if (commands.length === 0) return;

            this._lastHandledResponse = lastResponse;

            const outputs = [];

            if (process.env.AUTO_EXEC !== 'true') {
                // Skip confirm if user already chose 'a' this session
                if (!this.session.allowAll) {
                    const hasDangerous = commands.some(c => isDangerous(c));
                    console.log('');
                    commands.forEach((cmd) => {
                        const preview = cmd.includes('\n') ? cmd.split('\n')[0] + '...' : cmd;
                        const icon = isDangerous(cmd) ? chalk.red('  \u26a0  bash ') : chalk.dim('  \u2699  bash ');
                        process.stdout.write(icon + chalk.bold(preview) + '\n');
                    });
                    const sessionKey = await this.prompt.confirm(
                        hasDangerous
                            ? chalk.yellow(`  Run ${commands.length > 1 ? 'these commands' : 'this command'}? [y]es / [n]o / [a]ll: `)
                            : chalk.dim(`  Run ${commands.length > 1 ? 'these commands' : 'this command'}? [y]es / [n]o / [a]ll: `)
                    );
                    if (sessionKey === 'n') return;
                    if (sessionKey === 'a') this.session.allowAll = true;
                    else if (sessionKey !== 'y') return;
                }

                for (const cmd of commands) {
                    const preview = cmd.includes('\n') ? cmd.split('\n')[0] + '...' : cmd;
                    if (!this.session.allowAll && isDangerous(cmd)) {
                        process.stdout.write(chalk.red(`  \u26a0  bash `) + chalk.bold(preview) + '\n');
                        const key = await this.prompt.confirm(chalk.yellow('  Dangerous \u2014 confirm (y/n): '));
                        if (key !== 'y') { process.stdout.write(`  ${chalk.dim('\u2717 skipped')}\n`); continue; }
                    }
                    if (isInteractive(cmd)) {
                        outputs.push(`$ ${cmd}\n${await this.executor.executeInteractive(cmd, this.prompt)}`);
                        continue;
                    }
                    process.stdout.write(`  ${chalk.green('\u2713')} ${chalk.bold('bash')} ${chalk.dim(preview)}\n`);
                    const output = this.executor.execute(cmd);
                    if (output?.trim()) {
                        const lines = output.trim().split('\n').slice(0, 20);
                        process.stdout.write(chalk.dim(lines.join('\n')) + '\n');
                    }
                    outputs.push(`$ ${preview}\n${output}`);
                }
            } else {
                for (const cmd of commands) {
                    const preview = cmd.includes('\n') ? cmd.split('\n')[0] + '...' : cmd;
                    if (isInteractive(cmd)) {
                        outputs.push(`$ ${cmd}\n${await this.executor.executeInteractive(cmd, this.prompt)}`);
                        continue;
                    }
                    process.stdout.write(`  ${chalk.green('\u2713')} ${chalk.bold('bash')} ${chalk.dim(preview)}\n`);
                    const output = this.executor.execute(cmd);
                    if (output?.trim()) {
                        const lines = output.trim().split('\n').slice(0, 20);
                        process.stdout.write(chalk.dim(lines.join('\n')) + '\n');
                    }
                    outputs.push(`$ ${preview}\n${output}`);
                }
            }

            if (outputs.length === 0) return;

            await this.messageHandler.send(`[Command Results]\n${outputs.join('\n')}`, false);
            let full = '';
            await this.messageHandler.stream((chunk) => { full += chunk; });
            if (full.trim() && full.trim() !== '(no response)') process.stdout.write(renderMarkdown(full.trim(), this.agentMode) + '\n');
            this._printUsage();
            console.log('');

            iteration++;
        }
    }

    async _handleModelCommand(msg) {
        const parts = msg.trim().split(/\s+/);
        const newModel = parts[1];
        if (!newModel) {
            console.log(`Current model: ${this.model.model || 'unknown'}\n`);
            return;
        }
        console.log(`Switching model to: ${newModel}...`);
        try {
            this.model.setModel?.(newModel);
            this.messageHandler.reset();
            console.log(`Model changed to ${newModel}\n`);
        } catch (e) {
            console.log(`Error changing model: ${e.message}\n`);
        }
    }

    async _handleToolContext(msg) {
        // Handle tool context commands
    }

    _getCompletions() {
        return [
            'exit',
            'clear',
            '/model ',
            '/think',
            '/think on',
            '/think off'
        ];
    }

    /**
     * Graceful shutdown: close LSP, subagents, reset terminal.
     * Safe to call multiple times.
     */
    async cleanup() {
        if (this._cleaningUp) return;
        this._cleaningUp = true;
        try {
            if (this.tools) await this.tools.cleanup();
            if (this.model?.cleanup) await this.model.cleanup();
            if (this.subagentManager) this.subagentManager.cleanup();
        } catch {}
    }
}

module.exports = { ChatBot };
