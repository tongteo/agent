const axios = require('axios');

class OpenRouterAdapter {
    constructor(apiKey, model = 'arcee-ai/trinity-large-preview:free') {
        this.apiKey = apiKey;
        this.model = model;
        this.messages = [];
        this.tools = null; // set externally for function calling
        this.lastUsage = null;
        this.pendingToolCalls = null;
    }

    async init() {
        // No initialization needed for API
    }

    async *streamMessage() {
        this.pendingToolCalls = null;
        // Mark system message with cache_control for prompt caching (large context)
        const messages = this.messages.map(m =>
            m.role === 'system'
                ? { ...m, cache_control: { type: 'ephemeral' } }
                : m
        );

        const body = { model: this.model, messages, stream: true };
        if (this.tools?.length) body.tools = this.tools;

        const response = await axios.post('https://openrouter.ai/api/v1/chat/completions', body, {
            headers: {
                'Authorization': `Bearer ${this.apiKey}`,
                'Content-Type': 'application/json',
                'X-OpenRouter-Cache': 'true'
            },
            responseType: 'stream'
        });

        let fullContent = '';
        let buffer = '';
        const toolCallsMap = {}; // id -> {name, arguments}

        for await (const chunk of response.data) {
            buffer += chunk.toString();
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';
            
            for (const line of lines) {
                if (!line.startsWith('data: ')) continue;
                const data = line.slice(6).trim();
                if (data === '[DONE]' || !data) continue;
                try {
                    const parsed = JSON.parse(data);
                    if (parsed.usage) this.lastUsage = parsed.usage;

                    const delta = parsed.choices?.[0]?.delta;
                    if (!delta) continue;

                    // Accumulate tool_calls deltas
                    if (delta.tool_calls) {
                        for (const tc of delta.tool_calls) {
                            const idx = tc.index ?? 0;
                            if (!toolCallsMap[idx]) toolCallsMap[idx] = { id: tc.id, name: '', arguments: '' };
                            if (tc.id) toolCallsMap[idx].id = tc.id;
                            if (tc.function?.name) toolCallsMap[idx].name += tc.function.name;
                            if (tc.function?.arguments) toolCallsMap[idx].arguments += tc.function.arguments;
                        }
                    }

                    if (delta.content) { fullContent += delta.content; yield delta.content; }
                } catch (e) {}
            }
        }

        // Store completed tool calls
        const toolCalls = Object.values(toolCallsMap).filter(t => t.name);
        if (toolCalls.length) {
            this.pendingToolCalls = toolCalls;
            this.messages.push({ role: 'assistant', content: fullContent || null, tool_calls: toolCalls.map(t => ({
                id: t.id || `call_${t.name}`,
                type: 'function',
                function: { name: t.name, arguments: t.arguments }
            }))});
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

module.exports = { OpenRouterAdapter };
