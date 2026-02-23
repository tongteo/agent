const os = require('os');

class MessageHandler {
    constructor(model, session) {
        this.model = model;
        this.session = session;
        this.messageCount = 0;
    }

    getSystemContext() {
        return `[SYSTEM: OS=${os.platform()}, User=${os.userInfo().username}, Dir=${this.session.workingDir}]
[INSTRUCTION: Format shell commands in bash code blocks. Keep responses concise and technical.]`;
    }

    async send(message, includeContext = true) {
        const fullMessage = includeContext ? `${this.getSystemContext()}\n\n${message}` : message;
        await this.model.sendMessage(fullMessage);
    }

    async stream(onChunk) {
        const messages = await this.model.waitForResponse(this.messageCount);
        if (!messages || messages.length <= this.messageCount) {
            return null;
        }
        
        const lastMessage = messages[messages.length - 1];
        let lastText = '';
        
        for (let i = 0; i < 150; i++) {
            const currentText = await lastMessage.innerText();
            
            if (currentText && currentText !== lastText) {
                const newChars = currentText.slice(lastText.length);
                if (onChunk) onChunk(newChars);
                lastText = currentText;
            }
            
            if (!(await this.model.isStreaming())) {
                await this.model.page.waitForTimeout(500);
                const finalText = await lastMessage.innerText();
                if (finalText && finalText !== lastText) {
                    const newChars = finalText.slice(lastText.length);
                    if (onChunk) onChunk(newChars);
                    lastText = finalText;
                }
                break;
            }
            
            await this.model.page.waitForTimeout(200);
        }
        
        this.messageCount = messages.length;
        return lastText;
    }

    async getLastResponse() {
        const messages = await this.model.waitForResponse(this.messageCount);
        if (!messages || messages.length <= this.messageCount) {
            return null;
        }
        
        const lastMessage = messages[messages.length - 1];
        let lastText = '';
        
        for (let i = 0; i < 150; i++) {
            const currentText = await lastMessage.innerText();
            if (currentText) lastText = currentText;
            
            if (!(await this.model.isStreaming())) {
                await this.model.page.waitForTimeout(500);
                const finalText = await lastMessage.innerText();
                if (finalText) lastText = finalText;
                break;
            }
            
            await this.model.page.waitForTimeout(200);
        }
        
        this.messageCount = messages.length;
        return lastText;
    }

    reset() {
        this.messageCount = 0;
    }
}

module.exports = { MessageHandler };
