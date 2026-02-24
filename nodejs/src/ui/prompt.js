const readline = require('readline');

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
            this.rl.question(prompt, resolve);
        });
    }

    close() {
        if (this.rl) {
            this.rl.close();
        }
    }
}

module.exports = { PromptManager };
