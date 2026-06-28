const axios = require('axios');

class AnthropicAdapter {
    constructor(apiKey, model = 'claude-opus-4-7-20260101', baseUrl = 'https://api.anthropic.com') {
        this.apiKey = apiKey;
        this.model = model;
        this.baseUrl = baseUrl.replace(/\/$/, '');
        this.messages = [];
        this.tools = null;
        this.lastUsage = null;
        this.pendingToolCalls = null;
        this.maxTokens = parseInt(process.env.ANTHROPIC_MAX_TOKENS || '4096', 10);
        this._abort = null;
    }

    async init() {}

    abort() {
        if (this._abort) {
            try { this._abort.cancel('user abort'); } catch {}
        }
    }

    _convertTools() {
        if (!this.tools?.length) return null;
        return this.tools.map(t => {
            const fn = t.function || t;
            return {
                name: fn.name,
                description: fn.description || '',
                input_schema: fn.parameters || { type: 'object', properties: {} }
            };
        });
    }

    _convertMessages() {
        const system = [];
        const out = [];
        for (const m of this.messages) {
            if (m.role === 'system') {
                if (m.content) system.push(typeof m.content === 'string' ? m.content : JSON.stringify(m.content));
                continue;
            }
            if (m.role === 'tool') {
                const block = {
                    type: 'tool_result',
                    tool_use_id: m.tool_call_id,
                    content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content)
                };
                const last = out[out.length - 1];
                if (last && last.role === 'user' && Array.isArray(last.content)) {
                    last.content.push(block);
                } else {
                    out.push({ role: 'user', content: [block] });
                }
                continue;
            }
            if (m.role === 'assistant' && Array.isArray(m.tool_calls) && m.tool_calls.length) {
                const blocks = [];
                if (m.content) blocks.push({ type: 'text', text: m.content });
                for (const tc of m.tool_calls) {
                    let input = {};
                    try { input = tc.function?.arguments ? JSON.parse(tc.function.arguments) : {}; } catch {}
                    blocks.push({
                        type: 'tool_use',
                        id: tc.id,
                        name: tc.function?.name,
                        input
                    });
                }
                out.push({ role: 'assistant', content: blocks });
                continue;
            }
            if (m.role === 'user' || m.role === 'assistant') {
                out.push({ role: m.role, content: m.content ?? '' });
            }
        }
        return { system: system.join('\n\n'), messages: out };
    }

    async *streamMessage() {
        this.pendingToolCalls = null;
        const { system, messages } = this._convertMessages();
        const body = {
            model: this.model,
            max_tokens: this.maxTokens,
            messages,
            stream: true
        };
        if (system) body.system = system;
        const tools = this._convertTools();
        if (tools) body.tools = tools;

        const auth = process.env.ANTHROPIC_AUTH_TOKEN;
        const headers = {
            'Content-Type': 'application/json',
            'anthropic-version': '2023-06-01',
            'accept': 'text/event-stream'
        };
        if (auth) headers['Authorization'] = `Bearer ${auth}`;
        else headers['x-api-key'] = this.apiKey;

        const cancelSource = axios.CancelToken.source();
        this._abort = cancelSource;

        let response;
        for (let attempt = 0; attempt < 4; attempt++) {
            try {
                response = await axios.post(`${this.baseUrl}/v1/messages`, body, {
                    headers,
                    responseType: 'stream',
                    timeout: 300000,
                    cancelToken: cancelSource.token
                });
                break;
            } catch (e) {
                if (axios.isCancel(e)) return;
                const status = e.response?.status;
                if ((status === 429 || status === 503 || status === 529) && attempt < 3) {
                    const wait = (attempt + 1) * 2000;
                    yield `(rate limited, retrying in ${wait / 1000}s...)`;
                    await new Promise(r => setTimeout(r, wait));
                    continue;
                }
                if (e.response?.data) {
                    const errBody = await new Promise(resolve => {
                        let s = '';
                        e.response.data.on('data', d => s += d.toString());
                        e.response.data.on('end', () => resolve(s));
                        e.response.data.on('error', () => resolve(s));
                    });
                    throw new Error(`Anthropic HTTP ${status}: ${errBody.slice(0, 500)}`);
                }
                throw e;
            }
        }

        let buffer = '';
        let fullText = '';
        const toolBlocks = {};
        let usagePartial = null;
        const IDLE_MS = 300000;
        let idleTimer = setTimeout(() => response.data.destroy(new Error('Stream idle timeout')), IDLE_MS);
        const resetIdle = () => { clearTimeout(idleTimer); idleTimer = setTimeout(() => response.data.destroy(new Error('Stream idle timeout')), IDLE_MS); };

        try {
            for await (const chunk of response.data) {
                resetIdle();
                buffer += chunk.toString();
                const events = buffer.split('\n\n');
                buffer = events.pop() || '';
                for (const ev of events) {
                    const dataLine = ev.split('\n').find(l => l.startsWith('data: '));
                    if (!dataLine) continue;
                    const data = dataLine.slice(6).trim();
                    if (!data) continue;
                    let parsed;
                    try { parsed = JSON.parse(data); } catch { continue; }

                    switch (parsed.type) {
                        case 'message_start':
                            if (parsed.message?.usage) usagePartial = { ...parsed.message.usage };
                            break;
                        case 'content_block_start': {
                            const cb = parsed.content_block;
                            if (cb?.type === 'tool_use') {
                                toolBlocks[parsed.index] = { id: cb.id, name: cb.name, input: '' };
                            }
                            break;
                        }
                        case 'content_block_delta': {
                            const d = parsed.delta;
                            if (!d) break;
                            if (d.type === 'text_delta' && d.text) {
                                fullText += d.text;
                                yield d.text;
                            } else if (d.type === 'input_json_delta' && toolBlocks[parsed.index]) {
                                toolBlocks[parsed.index].input += d.partial_json || '';
                            }
                            break;
                        }
                        case 'message_delta':
                            if (parsed.usage) usagePartial = { ...(usagePartial || {}), ...parsed.usage };
                            break;
                        case 'message_stop':
                            break;
                        case 'error':
                            throw new Error(`Anthropic stream error: ${JSON.stringify(parsed.error)}`);
                    }
                }
            }
        } finally {
            clearTimeout(idleTimer);
            this._abort = null;
        }

        if (usagePartial) {
            this.lastUsage = {
                prompt_tokens: usagePartial.input_tokens || 0,
                completion_tokens: usagePartial.output_tokens || 0,
                cache_read_input_tokens: usagePartial.cache_read_input_tokens || 0,
                cache_creation_input_tokens: usagePartial.cache_creation_input_tokens || 0
            };
        }

        const toolCalls = Object.values(toolBlocks).filter(t => t.name);
        if (toolCalls.length) {
            this.pendingToolCalls = toolCalls.map(t => ({
                id: t.id,
                name: t.name,
                arguments: t.input || '{}'
            }));
            this.messages.push({
                role: 'assistant',
                content: fullText || null,
                tool_calls: toolCalls.map(t => ({
                    id: t.id,
                    type: 'function',
                    function: { name: t.name, arguments: t.input || '{}' }
                }))
            });
        } else {
            this.messages.push({ role: 'assistant', content: fullText });
        }
    }

    reset() {
        this.messages = [];
        this.lastUsage = null;
        this.pendingToolCalls = null;
    }
}

module.exports = { AnthropicAdapter };
