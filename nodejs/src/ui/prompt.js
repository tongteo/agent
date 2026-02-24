const readline = require('readline');
const chalk = require('chalk');

class PromptManager {
    constructor() {
        this.rl = null;
        this.completions = [
            '/model',
            '/model openai/gpt-oss-120b:free',
            '/model z-ai/glm-4.5-air:free',
            '/model stepfun/step-3.5-flash:free',
            '/model arcee-ai/trinity-large-preview:free',
            'exit',
            'clear'
        ];
    }

    init() {
        this.rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
            completer: (line) => {
                const hits = this.completions.filter(c => c.startsWith(line));
                return [hits.length ? hits : this.completions, line];
            }
        });
    }

    async ask(prompt) {
        return new Promise((resolve) => {
            if (!this.rl || this.rl.closed) {
                this.init();
            }
            
            let currentInput = '';
            let ghostText = '';
            
            process.stdout.write(prompt);
            
            const stdin = process.stdin;
            stdin.setRawMode(true);
            stdin.resume();
            stdin.setEncoding('utf8');
            
            const onData = (key) => {
                // Ctrl+C
                if (key === '\u0003') {
                    process.exit();
                }
                
                // Enter
                if (key === '\r' || key === '\n') {
                    stdin.setRawMode(false);
                    stdin.pause();
                    stdin.removeListener('data', onData);
                    process.stdout.write('\n');
                    resolve(currentInput);
                    return;
                }
                
                // Tab - autocomplete
                if (key === '\t') {
                    const matches = this.completions.filter(c => c.startsWith(currentInput));
                    if (matches.length > 0) {
                        // Clear current line
                        readline.clearLine(process.stdout, 0);
                        readline.cursorTo(process.stdout, 0);
                        currentInput = matches[0];
                        process.stdout.write(prompt + currentInput);
                        ghostText = '';
                    }
                    return;
                }
                
                // Backspace
                if (key === '\u007f') {
                    if (currentInput.length > 0) {
                        currentInput = currentInput.slice(0, -1);
                        readline.clearLine(process.stdout, 0);
                        readline.cursorTo(process.stdout, 0);
                        
                        // Find ghost text
                        const match = this.completions.find(c => c.startsWith(currentInput) && c !== currentInput);
                        ghostText = match ? match.slice(currentInput.length) : '';
                        
                        process.stdout.write(prompt + currentInput + chalk.gray(ghostText));
                        readline.cursorTo(process.stdout, prompt.length + currentInput.length);
                    }
                    return;
                }
                
                // Regular character
                if (key.length === 1 && key >= ' ') {
                    currentInput += key;
                    
                    // Find ghost text
                    const match = this.completions.find(c => c.startsWith(currentInput) && c !== currentInput);
                    ghostText = match ? match.slice(currentInput.length) : '';
                    
                    // Clear and redraw
                    readline.clearLine(process.stdout, 0);
                    readline.cursorTo(process.stdout, 0);
                    process.stdout.write(prompt + currentInput + chalk.gray(ghostText));
                    readline.cursorTo(process.stdout, prompt.length + currentInput.length);
                }
            };
            
            stdin.on('data', onData);
        });
    }

    close() {
        if (this.rl) {
            this.rl.close();
        }
    }
}

module.exports = { PromptManager };
