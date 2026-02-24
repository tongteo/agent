const chalk = require('chalk');
const { SessionManager } = require('./core/session');
const { MessageHandler } = require('./core/message');
const { OpenRouterAdapter } = require('./models/openrouter');
const { CommandExecutor } = require('./commands/executor');
const { extractCommands } = require('./commands/parser');
const { isDangerous, isInteractive, confirmDangerous } = require('./commands/validator');
const { formatOutput, formatMath } = require('./ui/formatter');
const { PromptManager } = require('./ui/prompt');
const { ToolRegistry } = require('./core/tools');
const { AgentPrompt, ToolParser } = require('./core/agent');
const { SubagentManager } = require('./core/subagent');

class ChatBot {
    constructor(apiKey, model = 'arcee-ai/trinity-large-preview:free', agentMode = false) {
        this.apiKey = apiKey;
        this.modelName = model;
        this.agentMode = agentMode;
        this.session = new SessionManager();
        this.prompt = new PromptManager();
        this.model = null;
        this.messageHandler = null;
        this.executor = null;
        this.tools = agentMode ? new ToolRegistry() : null;
        this.subagentManager = agentMode ? new SubagentManager(apiKey, model, process.cwd()) : null;
    }

    async init() {
        const mode = this.agentMode ? ' (Agent Mode)' : '';
        console.log(`🚀 Starting OpenRouter${mode}...\n`);
        
        this.session.load();
        
        this.model = new OpenRouterAdapter(this.apiKey, this.modelName);
        await this.model.init();
        
        const agentPrompt = this.agentMode ? AgentPrompt.getSystemPrompt(this.tools) : null;
        this.messageHandler = new MessageHandler(this.model, this.session, agentPrompt);
        this.executor = new CommandExecutor(this.session);
        
        if (this.agentMode && this.subagentManager) {
            this.tools.setSubagentManager(this.subagentManager);
        }
        
        // Change to session working directory
        if (this.session.workingDir && this.session.workingDir !== process.cwd()) {
            process.chdir(this.session.workingDir);
            console.log(chalk.cyan(`📂 Restored session: ${this.session.workingDir}\n`));
        }
        
        console.log(`✓ Ready! Using ${chalk.bold(this.modelName)}${mode}`);
        console.log(chalk.gray(`  Commands: 'exit' to quit | 'clear' to reset | '/model <name>' to change model`));
        console.log(chalk.gray(`  Tip: Press Tab for autocomplete\n`));
    }

    async clearChat() {
        this.model.reset();
        this.messageHandler.reset();
        this.session.reset();
        console.log("\n🔄 New conversation started (working directory and env vars reset)\n");
    }

    async chat() {
        this.prompt.init();

        while (true) {
            // Ensure stdin is in normal mode before asking
            if (process.stdin.setRawMode) {
                process.stdin.setRawMode(false);
            }
            
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
                
                // Show spinner while streaming
                const spinner = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
                let i = 0;
                let hasOutput = false;
                let buffer = '';
                let hasTool = false;
                const interval = setInterval(() => {
                    if (!hasOutput) {
                        process.stdout.write(`\r🤖 ${spinner[i]} Thinking...`);
                        i = (i + 1) % spinner.length;
                    }
                }, 80);
                
                await this.messageHandler.stream((chunk) => {
                    buffer += chunk;
                    
                    // Check if buffer contains complete tool tags
                    if (buffer.includes('<tool>') || buffer.includes('<params>')) {
                        hasTool = true;
                        return;
                    }
                    
                    // If we see start of tool tag or just '<', wait for more
                    if (/<\s*$|<tool|<param/.test(buffer)) {
                        return;
                    }
                    
                    // Regular text - clear spinner and show output
                    if (!hasOutput && !hasTool) {
                        clearInterval(interval);
                        process.stdout.write('\r\x1b[K🤖 ');
                        hasOutput = true;
                        // Output all buffered content
                        process.stdout.write(formatMath(buffer));
                        return;
                    }
                    
                    if (hasOutput) {
                        process.stdout.write(formatMath(chunk));
                    }
                });
                
                clearInterval(interval);
                if (!hasOutput) {
                    process.stdout.write('\r\x1b[K🤖 ✓ Ready\n');
                }
                console.log('\n');
                
                // Agent mode: handle tool calls
                if (this.agentMode) {
                    await this.handleToolCalls();
                }
                
                await this.handleCommands();
            }
        }
    }

    async handleCommands() {
        while (true) {
            const lastResponse = await this.getLastResponse();
            if (!lastResponse) break;
            
            const commands = extractCommands(lastResponse);
            if (commands.length === 0) break;
            
            const autoExecute = process.env.AUTO_EXEC === 'true';
            let answer;
            
            if (autoExecute) {
                console.log('\n⚠️  AUTO-EXEC MODE: Running commands...');
                answer = 'auto';
            } else {
                console.log('\n💡 Found shell commands. Execute? (y/n/select/auto): ');
                answer = await this.prompt.ask('');
            }
            
            if (answer.toLowerCase() === 'y' || answer.toLowerCase() === 'auto') {
                await this.executeAllCommands(commands, answer.toLowerCase() === 'auto');
            } else if (answer.toLowerCase() === 's' || answer.toLowerCase() === 'select') {
                await this.selectAndExecute(commands);
            } else {
                break;
            }
        }
    }

    async handleToolCalls(maxIterations = 5) {
        let iteration = 0;
        let consecutiveReplaces = 0;
        let lastTool = null;
        
        while (iteration < maxIterations) {
            const lastResponse = await this.getLastResponse();
            if (!lastResponse) break;
            
            const toolCalls = ToolParser.parse(lastResponse);
            if (toolCalls.length === 0) break;
            
            // Detect multiple str_replace calls
            if (toolCalls.length === 1 && toolCalls[0].tool === 'str_replace' && lastTool === 'str_replace') {
                consecutiveReplaces++;
                if (consecutiveReplaces >= 2) {
                    console.log(chalk.yellow('\n⚠️  Multiple str_replace detected. Consider using write_file instead.\n'));
                }
            } else {
                consecutiveReplaces = 0;
            }
            
            console.log(chalk.cyan(`\n🔧 Executing ${toolCalls.length} tool(s)...\n`));
            
            const results = [];
            for (const { tool, params } of toolCalls) {
                lastTool = tool;
                console.log(chalk.gray(`  → ${tool}(${JSON.stringify(params)})`));
                try {
                    const result = await this.tools.execute(tool, params);
                    
                    // Display diff/create output to user
                    if (result && result.includes('╭─')) {
                        console.log('\n' + result);
                    }
                    
                    // Display execute output to user
                    if (tool === 'execute' && result && !result.startsWith('Error:')) {
                        console.log(chalk.cyan('\n📤 Output:\n') + result);
                    }
                    
                    // Truncate long results for AI
                    const truncated = result.length > 500 ? result.substring(0, 500) + '...(truncated)' : result;
                    results.push(`[${tool}] Success`);
                } catch (e) {
                    results.push(`[${tool}] Error: ${e.message}`);
                }
            }
            
            const feedback = `[Tool Results]\n${results.join('\n')}\n\nIf task needs more steps, continue. Otherwise respond briefly to confirm.`;
            console.log(chalk.cyan('\n📤 Sending results to AI...\n'));
            
            await this.messageHandler.send(feedback, false);
            
            process.stdout.write('🤖 ');
            let response = '';
            await this.messageHandler.stream((chunk) => {
                response += chunk;
                process.stdout.write(formatMath(chunk));
            });
            console.log('\n');
            
            iteration++;
            
            // Stop if no more tool calls in response
            const hasMoreTools = ToolParser.parse(response).length > 0;
            if (!hasMoreTools) {
                break;
            }
        }
        
        if (iteration >= maxIterations) {
            console.log(chalk.yellow(`\n⚠️  Reached maximum iterations (${maxIterations})\n`));
        }
    }

    async handleCommands() {
        while (true) {
            const lastResponse = await this.getLastResponse();
            if (!lastResponse) break;
            
            const commands = extractCommands(lastResponse);
            if (commands.length === 0) break;
            
            const autoExecute = process.env.AUTO_EXEC === 'true';
            let answer;
            
            if (autoExecute) {
                console.log('\n⚠️  AUTO-EXEC MODE: Running commands...');
                answer = 'auto';
            } else {
                console.log('\n💡 Found shell commands. Execute? (y/n/select/auto): ');
                answer = await this.prompt.ask('');
            }
            
            if (answer.toLowerCase() === 'y' || answer.toLowerCase() === 'auto') {
                await this.executeAllCommands(commands, answer.toLowerCase() === 'auto');
            } else if (answer.toLowerCase() === 's' || answer.toLowerCase() === 'select') {
                await this.selectAndExecute(commands);
            } else {
                break;
            }
        }
    }

    async executeAllCommands(commands, isAuto) {
        let outputs = [];
        
        for (const cmd of commands) {
            if (isDangerous(cmd)) {
                if (!(await confirmDangerous(cmd, this.prompt.ask.bind(this.prompt)))) {
                    console.log(chalk.green('✓ Skipped'));
                    continue;
                }
            }
            
            if (isInteractive(cmd)) {
                const output = await this.executor.executeInteractive(cmd, this.prompt.rl);
                outputs.push(`$ ${cmd}\n${output}`);
                continue;
            }
            
            const preview = cmd.includes('\n') ? cmd.split('\n')[0] + '...' : cmd;
            console.log(`\n${chalk.cyan('$')} ${preview}`);
            const output = this.executor.execute(cmd);
            console.log(formatOutput(output));
            outputs.push(`$ ${preview}\n${output}`);
        }
        
        if (outputs.length > 0) {
            const feedback = `[Command Results]\n${outputs.join('\n')}`;
            console.log(isAuto ? '\n📤 Sending results to AI...\n' : '\n📤 Results sent to AI\n');
            await this.messageHandler.send(feedback, false);
            
            process.stdout.write('\n🤖 ');
            await this.messageHandler.stream((chunk) => {
                process.stdout.write(formatMath(chunk));
            });
            console.log('\n');
        }
    }

    async selectAndExecute(commands) {
        for (let i = 0; i < commands.length; i++) {
            const preview = commands[i].includes('\n') ? commands[i].split('\n')[0] + '...' : commands[i];
            console.log(`${i + 1}. ${preview}`);
        }
        const choice = await this.prompt.ask('Select command number: ');
        const idx = parseInt(choice) - 1;
        
        if (idx >= 0 && idx < commands.length) {
            const cmd = commands[idx];
            
            if (isDangerous(cmd)) {
                if (!(await confirmDangerous(cmd, this.prompt.ask.bind(this.prompt)))) {
                    console.log(chalk.green('✓ Skipped'));
                    return;
                }
            }
            
            if (isInteractive(cmd)) {
                const output = await this.executor.executeInteractive(cmd, this.prompt.rl);
                const feedback = `[Command Result]\n$ ${cmd}\n${output}`;
                console.log('\n📤 Result sent to AI\n');
                await this.messageHandler.send(feedback, false);
                
                process.stdout.write('\n🤖 ');
                await this.messageHandler.stream((chunk) => {
                    process.stdout.write(formatMath(chunk));
                });
                console.log('\n');
                return;
            }
            
            const preview = cmd.includes('\n') ? cmd.split('\n')[0] + '...' : cmd;
            console.log(`\n${chalk.cyan('$')} ${preview}`);
            const output = this.executor.execute(cmd);
            console.log(formatOutput(output));
            
            const feedback = `[Command Result]\n$ ${preview}\n${output}`;
            console.log('\n📤 Result sent to AI\n');
            await this.messageHandler.send(feedback, false);
            
            process.stdout.write('\n🤖 ');
            await this.messageHandler.stream((chunk) => {
                process.stdout.write(formatMath(chunk));
            });
            console.log('\n');
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
