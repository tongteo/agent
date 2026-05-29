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
const { AgentPrompt, ToolParser } = require('./core/agent');
const { SubagentManager } = require('./core/subagent');

class ChatBot {
    constructor(apiKey, model = 'gemini-2.0-flash-lite', agentMode = false) {
        this.apiKey = apiKey;
        this.modelName = model;
        this.agentMode = agentMode;
        this.session = new SessionManager();
        this.prompt = new PromptManager();
        this.model = null;
        this.messageHandler = null;
        this.executor = null;
        this.tools = agentMode ? new ToolRegistry(this.session) : null;
        this.subagentManager = agentMode ? new SubagentManager(apiKey, model, process.cwd()) : null;
        this._lastHandledResponse = null;
    }

    async init() {
        const mode = this.agentMode ? ' (Agent Mode)' : '';
        console.log(`🚀 Starting${mode}...\n`);
        
        this.session.load();
        
        const baseUrl = process.env.CUSTOM_API_BASE;
        const openrouterKey = process.env.OPENROUTER_API_KEY;
        if (openrouterKey) {
            const { OpenRouterAdapter } = require('./models/openrouter');
            const orModel = process.env.OPENROUTER_MODEL || 'openrouter/owl-alpha';
            this.model = new OpenRouterAdapter(openrouterKey, orModel);
            // Enable native function calling for agent mode
            if (this.agentMode && this.tools) {
                this.model.tools = this.tools.getToolSchemas();
            }
        } else if (baseUrl) {
            this.model = new CustomAdapter(this.apiKey, this.modelName, baseUrl);
        } else {
            this.model = new GeminiAdapter(this.apiKey, this.modelName);
        }
        await this.model.init();

        // For OpenRouter with function calling, use minimal system prompt
        const agentPrompt = this.agentMode
            ? (this.model.tools ? 'You are an AI agent. Use the provided tools to complete tasks. After all tasks are done, respond briefly.' : AgentPrompt.getSystemPrompt(this.tools))
            : null;
        this.messageHandler = new MessageHandler(this.model, this.session, agentPrompt);
        this.executor = new CommandExecutor(this.session);
        
        if (this.agentMode && this.subagentManager) {
            this.tools.setSubagentManager(this.subagentManager);
        }
        
        console.log(`✓ Ready! Using ${chalk.bold(this.model.model)}${mode}`);
        console.log(chalk.gray(`  Commands: 'exit' to quit | 'clear' to reset | '/model <name>' to change model`));
        console.log(chalk.gray(`  Tip: Press Tab for autocomplete\n`));
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
        console.log("\n🔄 New conversation started (working directory and env vars reset)\n");
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
            const input = await this.prompt.ask('👤 You: ');
            const msg = input.trim();

            if (msg.toLowerCase() === 'exit') {
                console.log("\n👋 Goodbye!");
                this.prompt.close();
                process.exit(0);
            }

            if (msg.toLowerCase() === 'clear') {
                await this.clearChat();
                continue;
            }

            if (msg.startsWith('/model')) {
                const newModel = msg.split(' ')[1];
                if (newModel) {
                    this.messageHandler.model.model = newModel;
                    console.log(chalk.green(`✓ Model changed to: ${newModel}\n`));
                } else {
                    console.log(chalk.cyan(`Current model: ${this.messageHandler.model.model}\n`));
                }
                continue;
            }

            if (msg) {
                await this.messageHandler.send(msg);
                
                // Spinner while waiting
                const spinner = ['⠋','⠙','⠹','⠸','⠼','⠴','⠦','⠧','⠇','⠏'];
                let si = 0;
                let full = '';
                const interval = setInterval(() => process.stdout.write(`\r🤖 ${spinner[si++ % spinner.length]}`), 80);
                try {
                    await this.messageHandler.stream((chunk) => { full += chunk; });
                } finally {
                    clearInterval(interval);
                    process.stdout.write('\r\x1b[K');
                }

                if (full.trim() && !full.includes('<tool>')) {
                    console.log('🤖 ' + renderMarkdown(full.trim()));
                }
                this._printUsage();
                console.log('');
                
                // Agent mode: handle tool calls
                if (this.agentMode) {
                    await this.handleToolCalls();
                }
                
                await this.handleCommands();
            }
        }
    }

    async handleToolCalls(maxIterations = 5) {
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
                        console.log(chalk.dim('  │ ') + lines.join('\n' + chalk.dim('  │ ')));
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
            const interval = setInterval(() => process.stdout.write(`\r🤖 ${spinner[si++ % spinner.length]}`), 80);
            try {
                await this.messageHandler.stream((chunk) => { full += chunk; });
            } finally {
                clearInterval(interval);
                process.stdout.write('\r\x1b[K');
            }

            if (full.trim() && !full.includes('<tool>')) {
                console.log('🤖 ' + renderMarkdown(full.trim()));
            }
            console.log('');
            
            iteration++;
        }
        
        if (iteration >= maxIterations) {
            console.log(chalk.yellow(`\n⚠️  Reached maximum iterations (${maxIterations})\n`));
        }
    }

    async handleCommands() {
        const maxIterations = 5;
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
                        process.stdout.write(chalk.dim('  │ ') + lines.join('\n' + chalk.dim('  │ ')) + '\n');
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
                        process.stdout.write(chalk.dim('  │ ') + lines.join('\n' + chalk.dim('  │ ')) + '\n');
                    }
                    outputs.push(`$ ${preview}\n${output}`);
                }
            }

            if (outputs.length === 0) return;

            await this.messageHandler.send(`[Command Results]\n${outputs.join('\n')}`, false);
            let full = '';
            await this.messageHandler.stream((chunk) => { full += chunk; });
            if (full.trim()) console.log('🤖 ' + renderMarkdown(full.trim()));
            this._printUsage();
            console.log('');

            iteration++;
        }
    }

    async getLastResponse() {
        const messages = this.model.messages.filter(m => m.role === 'assistant');
        if (messages.length === 0) return null;
        return messages[messages.length - 1].content;
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
