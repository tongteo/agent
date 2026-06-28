const https = require('https');

class HuggingFaceAdapter {
    constructor(apiKey, model = 'openai/gpt-oss-120b:groq') {
        this.apiKey = apiKey;
        this.model = model;
        this.messages = [];
    }

    async init() {}

    async *streamMessage() {
        const body = JSON.stringify({ model: this.model, messages: this.messages, stream: true });

        const chunks = await new Promise((resolve, reject) => {
            const req = https.request('https://router.huggingface.co/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.apiKey}`,
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(body)
                }
            }, res => {
                const parts = [];
                res.on('data', d => parts.push(d));
                res.on('end', () => {
                    if (res.statusCode >= 400) {
                        reject(new Error(`HTTP ${res.statusCode}: ${Buffer.concat(parts).toString()}`));
                    } else {
                        resolve(parts);
                    }
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
                if (data === '[DONE]' || !data) continue;
                try {
                    const content = JSON.parse(data).choices?.[0]?.delta?.content;
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

module.exports = { HuggingFaceAdapter };
