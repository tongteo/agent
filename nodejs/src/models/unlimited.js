const https = require('https');
const http = require('http');

class UnlimitedAdapter {
    constructor(apiKey, model = 'gateway-gpt-5', baseUrl = 'https://unlimited.surf') {
        this.apiKey = apiKey;
        this.model = model;
        this.baseUrl = baseUrl.replace(/\/$/, '');
        this.messages = [];
        this.tools = null;
        this.pendingToolCalls = null;
    }

    async init() {}

    _buildPrompt() {
        let prompt = '';
        for (const m of this.messages) {
            if (m.role === 'system') prompt += `System: ${m.content}\n\n`;
            else if (m.role === 'user') prompt += `User: ${m.content}\n\n`;
            else if (m.role === 'assistant') {
                if (m.tool_calls) {
                    prompt += `Assistant: [Tool calls: ${m.tool_calls.map(t => t.function.name).join(', ')}]\n\n`;
                } else {
                    prompt += `Assistant: ${m.content}\n\n`;
                }
            } else if (m.role === 'tool') {
                prompt += `Tool result (${m.tool_call_id}): ${m.content}\n\n`;
            }
        }
        if (this.tools?.length) {
            prompt += '\nAvailable tools:\n';
            for (const t of this.tools) {
                const fn = t.function || t;
                prompt += `- ${fn.name}: ${fn.description}\n`;
            }
            prompt += '\nTo use tools, respond with: TOOL_CALL: tool_name {"param": "value"}\n';
        }
        return prompt.trim();
    }

    async *streamMessage() {
        this.pendingToolCalls = null;
        const body = JSON.stringify({
            message: this._buildPrompt(),
            model: this.model,
            effort: 'medium'
        });

        const url = new URL(this.baseUrl + '/api/chat');
        const lib = url.protocol === 'https:' ? https : http;

        const chunks = await new Promise((resolve, reject) => {
            const req = lib.request({
                hostname: url.hostname,
                port: url.port || (url.protocol === 'https:' ? 443 : 80),
                path: url.pathname,
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.apiKey}`,
                    'Content-Length': Buffer.byteLength(body)
                }
            }, res => {
                const parts = [];
                res.on('data', d => parts.push(d));
                res.on('end', () => {
                    if (res.statusCode >= 400) reject(new Error(`HTTP ${res.statusCode}`));
                    else resolve(parts);
                });
                res.on('error', reject);
            });
            req.on('error', reject);
            req.write(body);
            req.end();
        });

        let fullText = '', buf = '';
        let toolCallStarted = false;
        
        for (const chunk of chunks) {
            buf += chunk.toString();
            const lines = buf.split('\n');
            buf = lines.pop() ?? '';
            for (const line of lines) {
                if (!line.startsWith('data: ')) continue;
                const data = line.slice(6).trim();
                if (!data) continue;
                try {
                    const json = JSON.parse(data);
                    if (json.delta) {
                        fullText += json.delta;
                        // Don't yield text after TOOL_CALL: appears
                        if (!toolCallStarted && !fullText.includes('TOOL_CALL:')) {
                            yield json.delta;
                        } else {
                            toolCallStarted = true;
                        }
                    }
                } catch {}
            }
        }

        // Parse tool calls from response
        const toolMatches = [...fullText.matchAll(/TOOL_CALL:\s*(\w+)\s*({[^}]+})/g)];
        if (toolMatches.length > 0) {
            // Extract text before first tool call
            const textBeforeTool = fullText.substring(0, toolMatches[0].index).trim();
            
            this.pendingToolCalls = toolMatches.map((m, i) => ({
                id: `call_${Date.now()}_${i}`,
                name: m[1],
                arguments: m[2]
            }));
            this.messages.push({
                role: 'assistant',
                content: textBeforeTool || null,
                tool_calls: this.pendingToolCalls.map(t => ({
                    id: t.id,
                    type: 'function',
                    function: { name: t.name, arguments: t.arguments }
                }))
            });
        } else {
            this.messages.push({ role: 'assistant', content: fullText });
        }
    }

    reset() {
        this.messages = [];
        this.pendingToolCalls = null;
    }
}

module.exports = { UnlimitedAdapter };
