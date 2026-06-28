const chalk = require('chalk');
const { SessionManager } = require('./core/session');
const { MessageHandler } = require('./core/message');
const { GeminiAdapter } = require('./models/gemini');
const { CustomAdapter } = require('./models/custom');
const { CommandExecutor } = require('./commands/executor');
const { extractCommands } = require('./commands/parser');
const { isDangerous, isInteractive } = require('./commands/validator');
const { formatOutput, formatMath, renderMarkdown } = require('./ui/formatter');
const { PromptManager } = require('./ui/prompt');
const { ToolRegistry } = require('./core/tools');
const { AgentPrompt, ToolParser, IntentParser } = require('./core/agent');
const { SubagentManager } = require('./core/subagent');

class ChatBot {
    constructor(apiKey, model = 'gemini-2.0-flash-lite', agentMode = false, enableSubagents = true) {
        this.apiKey = apiKey;
        this.modelName = model;
        this.agentMode = agentMode;
        this.session = new SessionManager();
        this.prompt = new PromptManager();
        this.model = null;
        this.messageHandler = null;
        this.executor = null;
        this.tools = agentMode ? new ToolRegistry(this.session) : null;
        this.subagentManager = (agentMode && enableSubagents) ? new SubagentManager(apiKey, model, process.cwd()) : null;
        this._lastHandledResponse = null;
    }

    async init() {
        this.session.load();
        
        const baseUrl = process.env.CUSTOM_API_BASE;
        const openrouterKey = process.env.OPENROUTER_API_KEY;
        const ollamaModel = process.env.OLLAMA_MODEL;
        const geminiCookies = process.env.GEMINI_COOKIES;
        const claudeCookies = process.env.CLAUDE_COOKIES;
        const unlimitedKey = process.env.UNLIMITED_API_KEY;
        const anthropicKey = process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN;
        if (unlimitedKey) {
            const { UnlimitedAdapter } = require('./models/unlimited');
            const unlimitedModel = process.env.UNLIMITED_MODEL || 'gateway-gpt-5';
            const unlimitedBase = process.env.UNLIMITED_BASE_URL || 'https://unlimited.surf';
            this.model = new UnlimitedAdapter(unlimitedKey, unlimitedModel, unlimitedBase);
            if (this.agentMode && this.tools) {
                this.model.tools = this.tools.getToolSchemas();
            }
        } else if (anthropicKey) {
            const { AnthropicAdapter } = require('./models/anthropic');
            const anthropicModel = process.env.ANTHROPIC_MODEL || 'claude-opus-4-7-20260101';
            const anthropicBase = process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com';
            this.model = new AnthropicAdapter(anthropicKey, anthropicModel, anthropicBase);
            if (this.agentMode && this.tools) {
                this.model.tools = this.tools.getToolSchemas();
            }
        } else if (claudeCookies) {
            const { ClaudeCookiesAdapter } = require('./models/claude-cookies');
            this.model = new ClaudeCookiesAdapter();
        } else if (geminiCookies) {
            const { GeminiCookiesAdapter } = require('./models/gemini-cookies');
            this.model = new GeminiCookiesAdapter();
        } else if (ollamaModel) {
            const { OllamaAdapter } = require('./models/ollama');
            const ollamaBase = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
            this.model = new OllamaAdapter(ollamaModel, ollamaBase);
            if (this.agentMode && this.tools) {
                this.model.tools = this.tools.getToolSchemas();
            }
        } else if (openrouterKey) {
            const { OpenRouterAdapter } = require('./models/openrouter');
            const orModel = process.env.OPENROUTER_MODEL || 'openrouter/owl-alpha';
            this.model = new OpenRouterAdapter(openrouterKey, orModel);
            if (this.agentMode && this.tools) {
                this.model.tools = this.tools.getToolSchemas();
            }
        } else if (baseUrl) {
            this.model = new CustomAdapter(this.apiKey, this.modelName, baseUrl);
        } else {
            this.model = new GeminiAdapter(this.apiKey, this.modelName);
        }
        await this.model.init();

        const agentPrompt = this.agentMode
            ? (this.model.tools
                ? 'You are an AI agent. Use the provided tools to complete tasks. After all tasks are done, respond briefly.'
                : (this.model.model === 'gemini-web' || this.model.model === 'claude-web')
                    ? AgentPrompt.getCompactPrompt(this.tools)
                    : AgentPrompt.getSystemPrompt(this.tools))
            : null;
        this.messageHandler = new MessageHandler(this.model, this.session, agentPrompt);
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
            chalk.dim('  exit  clear  /model <name>  [Tab]\n') +
            '\n'
        );
    }

    _printUsage() {
        const u = this.model?.lastUsage;
        if (!u) return;
        const cached = u.prompt_tokens_details?.cached_tokens ?? u.cache_read_input_tokens ?? 0;
        const parts = [`↑${u.prompt_tokens}`, cached ? chalk.green(`⚡${cached}`) : null, `↓${u.completion_tokens}`].filter(Boolean);
        process.stdout.write(chalk.dim(`  ${parts.join(' ')}\n`));
    }

    async clearChat() {
        this.model.reset();
        this.messageHandler.reset();
        this.session.reset();
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
            const input = await this.prompt.ask(chalk.bold.green('❯ '), this._getCompletions());
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

            if (msg) {
                // Pre-flight: if agent mode and user input is a clear action command,
                // dispatch tool directly without asking Gemini
                if (this.agentMode && this.model.model === 'gemini-web') {
                    const directCall = IntentParser.parseUserInput(msg);
                    if (directCall) {
                        const { tool, params } = directCall;
                        const label = params.path || params.command || '';
                        process.stdout.write(`  ${chalk.green('✓')} ${chalk.bold(tool)}${label ? chalk.dim(' ' + label) : ''}\n`);
                        try {
                            const result = await this.tools.execute(tool, params);
                            const displayTools = ['execute', 'bash', 'run_command'];
                            if (displayTools.includes(tool) && result) {
                                const lines = result.trim().split('\n').slice(0, 20);
                                console.log(chalk.dim(lines.join('\n')));
                            }
                            // Feed result back to model for follow-up
                            await this.messageHandler.send(`User ran: ${msg}\nResult:\n${result}`, false);
                        } catch (e) {
                            process.stdout.write(`  ${chalk.red('✗')} ${e.message}\n`);
                            await this.messageHandler.send(`User ran: ${msg}\nError: ${e.message}`, false);
                        }
                    } else {
                        await this.messageHandler.send(msg);
                    }
                } else {
                    await this.messageHandler.send(msg);
                }
                
                // Spinner while waiting
                const spinner = ['⠋','⠙','⠹','⠸','⠼','⠴','⠦','⠧','⠇','⠏'];
                let si = 0;
                let full = '';
                let aborted = false;
                const interval = setInterval(() => process.stdout.write(`\r${chalk.dim(spinner[si++ % spinner.length])}`), 80);
                const sigintHandler = () => {
                    aborted = true;
                    this.model.abort?.();
                };
                process.removeListener('SIGINT', this.prompt._sigintDefault);
                process.once('SIGINT', sigintHandler);
                try {
                    await this.messageHandler.stream((chunk) => { full += chunk; });
                } finally {
                    clearInterval(interval);
                    process.removeListener('SIGINT', sigintHandler);
                    process.addListener('SIGINT', this.prompt._sigintDefault);
                    process.stdout.write('\r\x1b[K');
                }

                if (aborted) {
                    process.stdout.write(chalk.dim('  ↩ interrupted\n\n'));
                    continue;
                }

                const hasToolCall = full.includes('<tool>') || full.includes('&lt;tool&gt;') || full.includes('<longcat_tool_call>') || full.includes('TOOL_CALL:') || this.model.pendingToolCalls?.length > 0;
                if (full.trim() && !hasToolCall) {
                    process.stdout.write(renderMarkdown(full.trim()) + '\n');
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

    async handleToolCalls(maxIterations = 20) {
        let iteration = 0;

        while (iteration < maxIterations) {
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
                // Fallback: intent parsing for models that don't follow XML format (e.g. gemini-web)
                if (toolCalls.length === 0 && this.model.model === 'gemini-web') {
                    const ctx = { lastFile: this._lastMentionedFile(lastResponse) };
                    toolCalls = IntentParser.parse(lastResponse, ctx).map(tc => ({ ...tc, id: null }));
                }
                // Fallback: extract code block and write to mentioned file
                if (toolCalls.length === 0 && this.model.model === 'gemini-web') {
                    const fileMatch = lastResponse.match(/(?:file\s+(?:named?\s+)?|tên\s+(?:là\s+)?|lưu\s+(?:vào\s+)?(?:file\s+)?)[`'"]?([\w./]+\.\w+)[`'"]?/i);
                    const codeMatch = lastResponse.match(/```(?:\w+)?\n([\s\S]+?)```/);
                    if (fileMatch && codeMatch && codeMatch[1].length > 100) {
                        toolCalls = [{ tool: 'write_file', params: { path: fileMatch[1], content: codeMatch[1].trim() }, id: null }];
                    }
                }
            }

            if (toolCalls.length === 0) break;
            
            const results = [];
            for (const { tool, params, id } of toolCalls) {
                const label = params.path || params.command || params.query || '';
                process.stdout.write(chalk.dim(`  ⚙  ${tool}`) + (label ? chalk.dim(` ${label}`) : '') + ' ');
                const spinChars = ['⠋','⠙','⠹','⠸','⠼','⠴','⠦','⠧','⠇','⠏'];
                let si = 0;
                const spin = setInterval(() => process.stdout.write(`\r  ⚙  ${tool}${label ? ' ' + label : ''} ${spinChars[si++ % spinChars.length]}`), 80);
                try {
                    const result = await this.tools.execute(tool, params);
                    clearInterval(spin);
                    process.stdout.write(`\r\x1b[K  ${chalk.green('✓')} ${chalk.bold(tool)}${label ? chalk.dim(' ' + label) : ''}\n`);

                    const displayTools = ['execute', 'bash', 'tree', 'git', 'analyze_code', 'debug_trace'];
                    if (displayTools.includes(tool) && result && !result.startsWith('Error:')) {
                        const lines = result.trim().split('\n').slice(0, 20);
                        console.log(chalk.dim(lines.join('\n')));
                    }

                    const truncated = result.length > 8000 ? result.substring(0, 8000) + '...(truncated)' : result;
                    results.push({ tool, id, result: truncated });
                } catch (e) {
                    clearInterval(spin);
                    process.stdout.write(`\r\x1b[K  ${chalk.red('✗')} ${chalk.bold(tool)}${label ? chalk.dim(' ' + label) : ''}: ${e.message}\n`);
                    results.push({ tool, id, result: `Error: ${e.message}` });
                }
            }

            // For function calling: push tool role messages; for XML: send as user message
            if (results[0]?.id) {
                for (const { tool, id, result } of results) {
                    this.model.messages.push({ role: 'tool', tool_call_id: id, name: tool, content: result });
                }
                await this.messageHandler.send(null, false); // trigger stream without adding user msg
            } else {
                const feedback = `[Tool Results]\n${results.map(r => `[${r.tool}] ${r.result}`).join('\n')}\n\nIf task needs more steps, continue. Otherwise respond briefly to confirm.`;
                await this.messageHandler.send(feedback, false);
            }
            
            // Stream response
            const spinner = ['⠋','⠙','⠹','⠸','⠼','⠴','⠦','⠧','⠇','⠏'];
            let si = 0;
            let full = '';
            let aborted = false;
            const STREAM_TIMEOUT = 300000; // 5 minutes
            const streamTimeout = setTimeout(() => {
                aborted = true;
                this.model.abort?.();
                console.log(chalk.yellow(`\n⚠️  Stream timeout (${STREAM_TIMEOUT / 1000}s)\n`));
            }, STREAM_TIMEOUT);
            const sigintHandler = () => { aborted = true; this.model.abort?.(); };
            process.removeListener('SIGINT', this.prompt._sigintDefault);
            process.once('SIGINT', sigintHandler);
            const interval = setInterval(() => process.stdout.write(`\r${chalk.dim(spinner[si++ % spinner.length])}`), 80);
            try {
                await this.messageHandler.stream((chunk) => { full += chunk; });
            } finally {
                clearTimeout(streamTimeout);
                clearInterval(interval);
                process.removeListener('SIGINT', sigintHandler);
                process.addListener('SIGINT', this.prompt._sigintDefault);
                process.stdout.write('\r\x1b[K');
            }

            if (full.trim() && !full.includes('<tool>')) {
                process.stdout.write(renderMarkdown(full.trim()) + '\n');
            }
            console.log('');

            if (aborted) break;
            iteration++;
        }
        
        if (iteration >= maxIterations) {
            console.log(chalk.yellow(`\n⚠️  Reached maximum iterations (${maxIterations})\n`));
        }
    }

    async handleCommands() {
        const maxIterations = 20;
        let iteration = 0;

        while (iteration < maxIterations) {
            const lastResponse = await this.getLastResponse();
            if (!lastResponse || lastResponse === this._lastHandledResponse) return;

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
                        const icon = isDangerous(cmd) ? chalk.red('  ⚠  bash ') : chalk.dim('  ⚙  bash ');
                        process.stdout.write(icon + chalk.bold(preview) + '\n');
                    });
                    const sessionKey = await this.prompt.confirm(
                        hasDangerous
                            ? chalk.yellow(`  Run ${commands.length > 1 ? 'these commands' : 'this command'}? [y]es / [n]o / [a]ll: `)
                            : chalk.dim(`  Run ${commands.length > 1 ? 'these commands' : 'this command'}? [y]es / [n]o / [a]ll: `)
                    );
                    if (sessionKey === 'n' || sessionKey === '\u0003') return;
                    if (sessionKey === 'a') this.session.allowAll = true;
                    else if (sessionKey !== 'y') return;
                }

                for (const cmd of commands) {
                    const preview = cmd.includes('\n') ? cmd.split('\n')[0] + '...' : cmd;
                    if (!this.session.allowAll && isDangerous(cmd)) {
                        process.stdout.write(chalk.red(`  ⚠  bash `) + chalk.bold(preview) + '\n');
                        const key = await this.prompt.confirm(chalk.yellow('  Dangerous — confirm (y/n): '));
                        if (key !== 'y') { process.stdout.write(`  ${chalk.dim('✗ skipped')}\n`); continue; }
                    }
                    if (isInteractive(cmd)) {
                        outputs.push(`$ ${cmd}\n${await this.executor.executeInteractive(cmd, this.prompt)}`);
                        continue;
                    }
                    process.stdout.write(`  ${chalk.green('✓')} ${chalk.bold('bash')} ${chalk.dim(preview)}\n`);
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
                    process.stdout.write(`  ${chalk.green('✓')} ${chalk.bold('bash')} ${chalk.dim(preview)}\n`);
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
            if (full.trim()) process.stdout.write(renderMarkdown(full.trim()) + '\n');
            this._printUsage();
            console.log('');

            iteration++;
        }
    }

    async _handleModelCommand(msg) {
        const parts = msg.trim().split(/\s+/);
        // /model list
        if (parts[1] === 'list') {
            await this._listModels();
            return;
        }
        // /model <provider> <model>  OR  /model <model>
        if (parts.length >= 3) {
            await this._switchProvider(parts[1], parts.slice(2).join(' '));
        } else if (parts.length === 2) {
            const modelArg = parts[1];
            if (modelArg === 'claude-web') {
                await this._switchProvider('claude-web', '');
            } else if (modelArg === 'gemini-web') {
                await this._switchProvider('gemini-web', '');
            } else {
                // Just change model name on current provider
                this.messageHandler.model.model = modelArg;
                console.log(chalk.green(`✓ Model: ${modelArg}\n`));
            }
        } else {
            const cur = this.messageHandler.model;
            const provider = cur.constructor.name.replace('Adapter', '').toLowerCase();
            console.log(chalk.cyan(`Provider: ${provider}  Model: ${cur.model}`));
            console.log(chalk.dim('Usage: /model list | /model <name> | /model <provider> <model>'));
            console.log(chalk.dim('Providers: ollama, openrouter, gemini, custom, gemini-web, claude-web\n'));
        }
    }

    async _listModels() {
        const axios = require('axios');
        const base = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
        try {
            const { data } = await axios.get(`${base}/api/tags`, { timeout: 3000 });
            const models = data.models?.map(m => m.name) || [];
            console.log(chalk.cyan('Ollama models:'));
            models.forEach(m => console.log('  ' + m));
            if (!models.length) console.log(chalk.dim('  (none)'));
        } catch {
            console.log(chalk.dim('Ollama not available'));
        }
        console.log('');
    }

    async _switchProvider(provider, modelName) {
        const prevMessages = this.messageHandler.model.messages.slice(); // keep history
        let newModel;
        switch (provider) {
            case 'claude-web': {
                const { ClaudeCookiesAdapter } = require('./models/claude-cookies');
                newModel = new ClaudeCookiesAdapter();
                break;
            }
            case 'gemini-web': {
                const { GeminiCookiesAdapter } = require('./models/gemini-cookies');
                newModel = new GeminiCookiesAdapter();
                break;
            }
            case 'ollama': {
                const { OllamaAdapter } = require('./models/ollama');
                newModel = new OllamaAdapter(modelName, process.env.OLLAMA_BASE_URL || 'http://localhost:11434');
                break;
            }
            case 'openrouter': {
                const { OpenRouterAdapter } = require('./models/openrouter');
                newModel = new OpenRouterAdapter(process.env.OPENROUTER_API_KEY, modelName);
                break;
            }
            case 'gemini': {
                const { GeminiAdapter } = require('./models/gemini');
                newModel = new GeminiAdapter(process.env.GEMINI_API_KEY || this.apiKey, modelName);
                break;
            }
            case 'custom': {
                const { CustomAdapter } = require('./models/custom');
                newModel = new CustomAdapter(process.env.CUSTOM_API_KEY || this.apiKey, modelName, process.env.CUSTOM_API_BASE);
                break;
            }
            case 'anthropic': {
                const { AnthropicAdapter } = require('./models/anthropic');
                const key = process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN;
                const base = process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com';
                newModel = new AnthropicAdapter(key, modelName || process.env.ANTHROPIC_MODEL || 'claude-opus-4-7-20260101', base);
                break;
            }
            default:
                console.log(chalk.red(`Unknown provider: ${provider}. Use: ollama, openrouter, gemini, custom, gemini-web, claude-web, anthropic\n`));
                return;
        }
        await newModel.init();
        // Don't carry over old history — web adapters maintain server-side context
        const isWebAdapter = ['claude-web', 'gemini-web'].includes(provider);
        newModel.messages = isWebAdapter ? [] : prevMessages;
        if (this.agentMode && this.tools) newModel.tools = this.tools.getToolSchemas();
        // Update agentPrompt for web adapters
        if (this.agentMode && isWebAdapter) {
            this.messageHandler.agentPrompt = AgentPrompt.getCompactPrompt(this.tools);
        }
        this.messageHandler.model = newModel;
        this.model = newModel;
        console.log(chalk.green(`✓ Switched to ${provider}${modelName ? '/' + modelName : ''}\n`));
    }

    async getLastResponse() {
        const messages = this.messageHandler.model.messages.filter(m => m.role === 'assistant');
        if (messages.length === 0) return null;
        return messages[messages.length - 1].content;
    }

    _lastMentionedFile(text) {
        const m = text?.match(/\b([\w./][\w./]*\.\w+)\b/);
        return m?.[1] || null;
    }

    _getCompletions() {
        const models = ['/model claude-web', '/model gemini-web'];
        const ollamaModel = process.env.OLLAMA_MODEL;
        if (ollamaModel) models.push(`/model ollama ${ollamaModel}`);
        const orModel = process.env.OPENROUTER_MODEL;
        if (orModel) models.push(`/model openrouter ${orModel}`);
        return ['exit', 'clear', ...models];
    }

    cleanup() {
        if (this.subagentManager) {
            this.subagentManager.cleanup();
        }
        if (this.tools) {
            this.tools.cleanup();
        }
    }
}

module.exports = { ChatBot };
