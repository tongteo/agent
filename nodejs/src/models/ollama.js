const axios = require('axios');

class OllamaAdapter {
    constructor(model = 'llama3.2', baseUrl = 'http://localhost:11434') {
        this.model = model;
        this.baseUrl = baseUrl;
        this.messages = [];
        this.tools = null;
        this.lastUsage = null;
        this.pendingToolCalls = null;
        this.showThinking = false; // set true to show <think> blocks
    }

    async init() {}

    _trimmedMessages(maxPairs = 10) {
        const sys = this.messages.filter(m => m.role === 'system');
        const rest = this.messages.filter(m => m.role !== 'system');
        const trimmed = rest.slice(-maxPairs * 2);
        return [...sys, ...trimmed];
    }

    async *streamMessage() {
        this.pendingToolCalls = null;

        const body = { model: this.model, messages: this._trimmedMessages(), stream: true, think: this.showThinking };
        if (this.tools?.length) body.tools = this.tools;

        const response = await axios.post(`${this.baseUrl}/api/chat`, body, {
            responseType: 'stream',
            timeout: 300000 // 5 min — reasoning models can be slow
        });

        let fullContent = '';
        const toolCallsMap = {};
        let thinkBuffer = '';
        let inThink = false;

        for await (const chunk of response.data) {
            const lines = chunk.toString().split('\n').filter(Boolean);
            for (const line of lines) {
                let parsed;
                try { parsed = JSON.parse(line); } catch { continue; }

                const msg = parsed.message;
                if (!msg) continue;

                if (msg.tool_calls) {
                    for (const tc of msg.tool_calls) {
                        const idx = Object.keys(toolCallsMap).length;
                        toolCallsMap[idx] = {
                            id: `call_${tc.function?.name}_${Date.now()}`,
                            name: tc.function?.name || '',
                            arguments: typeof tc.function?.arguments === 'string'
                                ? tc.function.arguments
                                : JSON.stringify(tc.function?.arguments || {})
                        };
                    }
                }

                if (msg.content) {
                    let text = msg.content;
                    fullContent += text;

                    if (!this.showThinking) {
                        // Buffer and strip <think>...</think> blocks
                        thinkBuffer += text;
                        let out = '';
                        while (true) {
                            if (!inThink) {
                                const start = thinkBuffer.indexOf('<think>');
                                if (start === -1) { out += thinkBuffer; thinkBuffer = ''; break; }
                                out += thinkBuffer.slice(0, start);
                                thinkBuffer = thinkBuffer.slice(start + 7);
                                inThink = true;
                            } else {
                                const end = thinkBuffer.indexOf('</think>');
                                if (end === -1) break; // still inside think block
                                thinkBuffer = thinkBuffer.slice(end + 8);
                                inThink = false;
                            }
                        }
                        if (out) yield out;
                    } else {
                        yield text;
                    }
                }
            }
        }

        const toolCalls = Object.values(toolCallsMap).filter(t => t.name);
        if (toolCalls.length) {
            this.pendingToolCalls = toolCalls;
            this.messages.push({
                role: 'assistant',
                content: fullContent || null,
                tool_calls: toolCalls.map(t => ({
                    id: t.id,
                    type: 'function',
                    function: { name: t.name, arguments: t.arguments }
                }))
            });
        } else {
            this.messages.push({ role: 'assistant', content: fullContent });
        }
    }

    reset() {
        this.messages = [];
        this.lastUsage = null;
        this.pendingToolCalls = null;
    }
}

module.exports = { OllamaAdapter };
