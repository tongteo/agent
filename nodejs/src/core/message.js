const os = require('os');

class MessageHandler {
    constructor(model, session, agentPrompt = null) {
        this.model = model;
        this.session = session;
        this.agentPrompt = agentPrompt;
    }

    getSystemContext() {
        if (this.agentPrompt) {
            return `[SYSTEM: OS=${os.platform()}, User=${os.userInfo().username}, Dir=${this.session.workingDir}]

${this.agentPrompt}`;
        }
        return `[SYSTEM: OS=${os.platform()}, User=${os.userInfo().username}, Dir=${this.session.workingDir}]
[INSTRUCTION: Format shell commands in bash code blocks. Keep responses concise and technical.]`;
    }

    async send(message, includeContext = true) {
        const systemPrompt = includeContext ? this.getSystemContext() : null;
        
        if (systemPrompt && this.model.messages.length === 0) {
            this.model.messages.push({ role: 'system', content: systemPrompt });
        }
        
        this.model.messages.push({ role: 'user', content: message });
    }

    async stream(onChunk) {
        // Stream from OpenRouter API
        let fullContent = '';
        
        try {
            for await (const chunk of this.model.streamMessage()) {
                fullContent += chunk;
                if (onChunk) onChunk(chunk);
            }
        } catch (error) {
            // Fallback to non-streaming
            const messages = this.model.messages.filter(m => m.role === 'assistant');
            if (messages.length > 0) {
                fullContent = messages[messages.length - 1].content;
                if (onChunk) onChunk(fullContent);
            }
        }
        
        return fullContent;
    }

    reset() {
        this.model.reset();
    }
}

module.exports = { MessageHandler };
