const https = require('https');

class GeminiAdapter {
    constructor(apiKey, model = 'gemini-2.0-flash-lite') {
        this.apiKey = apiKey;
        this.model = model;
        this.messages = [];
    }

    async init() {}

    _toGeminiContents() {
        return this.messages.map(m => ({
            role: m.role === 'assistant' ? 'model' : m.role,
            parts: [{ text: m.content }]
        }));
    }

    async *streamMessage() {
        const systemMsg = this.messages.find(m => m.role === 'system');
        const history = this.messages.filter(m => m.role !== 'system');

        const body = JSON.stringify({
            contents: history.map(m => ({
                role: m.role === 'assistant' ? 'model' : 'user',
                parts: [{ text: m.content }]
            })),
            ...(systemMsg && { systemInstruction: { parts: [{ text: systemMsg.content }] } })
        });

        const path = `/v1beta/models/${this.model}:streamGenerateContent?alt=sse&key=${this.apiKey}`;

        const chunks = await new Promise((resolve, reject) => {
            const req = https.request({ hostname: 'generativelanguage.googleapis.com', path, method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
            }, res => {
                const parts = [];
                res.on('data', d => parts.push(d));
                res.on('end', () => {
                    if (res.statusCode >= 400) reject(new Error(`HTTP ${res.statusCode}: ${Buffer.concat(parts).toString()}`));
                    else resolve(parts);
                });
                res.on('error', reject);
            });
            req.on('error', reject);
            req.write(body);
            req.end();
        });

        let fullContent = '', buf = '';
        for (const chunk of chunks) {
            buf += chunk.toString();
            const lines = buf.split('\n');
            buf = lines.pop() ?? '';
            for (const line of lines) {
                if (!line.startsWith('data:')) continue;
                const data = line.slice(5).trim();
                if (!data) continue;
                try {
                    const content = JSON.parse(data).candidates?.[0]?.content?.parts?.[0]?.text;
                    if (content) { fullContent += content; yield content; }
                } catch {}
            }
        }
        this.messages.push({ role: 'assistant', content: fullContent });
    }

    reset() {
        this.messages = [];
    }
}

module.exports = { GeminiAdapter };
