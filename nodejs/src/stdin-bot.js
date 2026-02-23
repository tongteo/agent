const { BrowserManager } = require('./core/browser');
const { SessionManager } = require('./core/session');
const { MessageHandler } = require('./core/message');
const { ChatGPTAdapter } = require('./models/chatgpt');
const { GeminiAdapter } = require('./models/gemini');

class StdinBot {
    constructor(modelType = 'chatgpt') {
        this.modelType = modelType;
        this.browser = new BrowserManager();
        this.session = new SessionManager();
        this.model = null;
        this.messageHandler = null;
    }

    async init() {
        const page = await this.browser.launch();
        this.model = this.modelType === 'gemini' ? new GeminiAdapter(page) : new ChatGPTAdapter(page);
        await this.model.init();
        
        this.messageHandler = new MessageHandler(this.model, this.session);
    }

    async processStdin() {
        let input = '';
        
        for await (const chunk of process.stdin) {
            input += chunk;
        }
        
        input = input.trim();
        if (!input) {
            console.error('No input provided');
            process.exit(1);
        }
        
        await this.messageHandler.send(input);
        const response = await this.messageHandler.getLastResponse();
        
        if (response) {
            console.log(response);
        } else {
            console.error('No response received');
            process.exit(1);
        }
    }

    async close() {
        await this.browser.close();
    }
}

module.exports = { StdinBot };
