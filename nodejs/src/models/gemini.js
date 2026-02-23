const { ModelAdapter } = require('./base');

class GeminiAdapter extends ModelAdapter {
    async init() {
        await this.page.goto('https://gemini.google.com', { waitUntil: 'domcontentloaded', timeout: 60000 });
        await this.page.waitForTimeout(5000);
    }

    async sendMessage(message) {
        await this.page.waitForSelector('.ql-editor', { timeout: 30000 });
        await this.page.fill('.ql-editor', message);
        await this.page.waitForTimeout(500);
        await this.page.click('button[aria-label*="Send"]');
    }

    async waitForResponse(messageCount) {
        let attempts = 0;
        while (attempts < 100) {
            await this.page.waitForTimeout(300);
            const messages = await this.page.$$(this.getResponseSelector());
            if (messages.length > messageCount) {
                const lastMessage = messages[messages.length - 1];
                const text = await lastMessage.textContent();
                if (text && text.trim().length > 0) return messages;
            }
            attempts++;
        }
        return null;
    }

    getResponseSelector() {
        return '.model-response-text';
    }

    async isStreaming() {
        return await this.page.$('button[aria-label*="Stop"]') !== null;
    }
}

module.exports = { GeminiAdapter };
