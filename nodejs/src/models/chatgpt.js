const { ModelAdapter } = require('./base');

class ChatGPTAdapter extends ModelAdapter {
    async init() {
        await this.page.goto('https://chatgpt.com', { waitUntil: 'networkidle', timeout: 60000 });
        await this.page.waitForTimeout(3000);
    }

    async sendMessage(message) {
        await this.page.waitForSelector('#prompt-textarea:not([disabled])', { timeout: 30000 });
        await this.page.fill('#prompt-textarea', message);
        await this.page.waitForTimeout(300);
        
        const fruitjuiceSendButton = await this.page.evaluate(() => {
            return document.querySelector('[data-testid="fruitjuice-send-button"]') !== null;
        });
        const sendButton = await this.page.evaluate(() => {
            return document.querySelector('[data-testid="send-button"]') !== null;
        });
        
        if (fruitjuiceSendButton) {
            await this.page.click('[data-testid="fruitjuice-send-button"]');
        } else if (sendButton) {
            await this.page.click('[data-testid="send-button"]');
        }
    }

    async waitForResponse(messageCount) {
        let attempts = 0;
        while (attempts < 30) {
            await this.page.waitForTimeout(500);
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
        return '[data-message-author-role="assistant"]';
    }

    async isStreaming() {
        return await this.page.$('[data-testid="stop-button"]') !== null;
    }
}

module.exports = { ChatGPTAdapter };
