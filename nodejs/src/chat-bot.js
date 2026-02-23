const chalk = require('chalk');
const { BrowserManager } = require('./core/browser');
const { SessionManager } = require('./core/session');
const { MessageHandler } = require('./core/message');
const { ChatGPTAdapter } = require('./models/chatgpt');
const { GeminiAdapter } = require('./models/gemini');
const { CommandExecutor } = require('./commands/executor');
const { extractCommands } = require('./commands/parser');
const { isDangerous, isInteractive, confirmDangerous } = require('./commands/validator');
const { formatOutput, formatMath } = require('./ui/formatter');
const { PromptManager } = require('./ui/prompt');

class ChatBot {
    constructor(modelType = 'chatgpt') {
        this.modelType = modelType;
        this.browser = new BrowserManager();
        this.session = new SessionManager();
        this.prompt = new PromptManager();
        this.model = null;
        this.messageHandler = null;
        this.executor = null;
    }

    async init() {
        const modelName = this.modelType === 'gemini' ? 'Gemini' : 'ChatGPT';
        console.log(`🚀 Starting ${modelName}...\n`);
        
        this.session.load();
        
        const page = await this.browser.launch();
        this.model = this.modelType === 'gemini' ? new GeminiAdapter(page) : new ChatGPTAdapter(page);
        await this.model.init();
        
        this.messageHandler = new MessageHandler(this.model, this.session);
        this.executor = new CommandExecutor(this.session);
        
        console.log(`✓ Ready! Using ${modelName}. Type 'exit' to quit, 'clear' to start new conversation\n`);
        if (this.session.workingDir !== process.cwd()) {
            console.log(chalk.cyan(`📂 Restored session: ${this.session.workingDir}\n`));
        }
    }

    async clearChat() {
        await this.model.page.reload({ waitUntil: 'networkidle' });
        await this.model.page.waitForTimeout(2000);
        this.messageHandler.reset();
        this.session.reset();
        console.log("\n🔄 New conversation started (working directory and env vars reset)\n");
    }

    async chat() {
        this.prompt.init();

        while (true) {
            const input = await this.prompt.ask('👤 You: ');
            const msg = input.trim();

            if (msg.toLowerCase() === 'exit') {
                console.log("\n👋 Goodbye!");
                this.prompt.close();
                await this.browser.close();
                process.exit(0);
            }

            if (msg.toLowerCase() === 'clear') {
                await this.clearChat();
                continue;
            }

            if (msg) {
                await this.messageHandler.send(msg);
                
                process.stdout.write('\n🤖 ');
                await this.messageHandler.stream((chunk) => {
                    process.stdout.write(formatMath(chunk));
                });
                console.log('\n');
                
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
        const messages = await this.model.page.$$(this.model.getResponseSelector());
        if (messages.length === 0) return null;
        return await messages[messages.length - 1].innerText();
    }
}

module.exports = { ChatBot };
