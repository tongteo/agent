const readline = require('readline');

class PromptManager {
    constructor() {
        this.rl = null;
    }

    init() {
        this.rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
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
