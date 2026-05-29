const os = require('os');

class MessageHandler {
    constructor(model, session, agentPrompt = null) {
        this.model = model;
        this.session = session;
        this.agentPrompt = agentPrompt;
    }

    getSystemContext() {
        const cwd = this.session.workingDir || process.cwd();
        if (this.agentPrompt) {
            return `[SYSTEM: OS=${os.platform()}, User=${os.userInfo().username}, Dir=${cwd}]\n\n${this.agentPrompt}`;
        }
        return `[SYSTEM: OS=${os.platform()}, User=${os.userInfo().username}, Dir=${cwd}]\n[INSTRUCTION: Format shell commands in bash code blocks. Keep responses concise and technical.]`;
    }

    async send(message, includeContext = true) {
        const systemPrompt = includeContext ? this.getSystemContext() : null;
        if (systemPrompt) {
            const sysIdx = this.model.messages.findIndex(m => m.role === 'system');
            if (sysIdx === -1) this.model.messages.unshift({ role: 'system', content: systemPrompt });
            else this.model.messages[sysIdx].content = systemPrompt;
        }
        if (message !== null) this.model.messages.push({ role: 'user', content: message });
    }

    async stream(onChunk) {
        let fullContent = '';
        try {
            for await (const chunk of this.model.streamMessage()) {
                fullContent += chunk;
                if (onChunk) onChunk(chunk);
            }
        } catch (error) {
            // Remove the dangling user message so history stays consistent
            const msgs = this.model.messages;
            if (msgs.length && msgs[msgs.length - 1].role === 'user') msgs.pop();
            const errMsg = `Error: ${error.message}`;
            if (onChunk) onChunk(errMsg);
            fullContent = errMsg;
        }
        if (!fullContent && onChunk) onChunk('(no response)');
        return fullContent;
    }

    reset() {
        this.model.reset();
    }
}

module.exports = { MessageHandler };
