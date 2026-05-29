const https = require('https');
const http = require('http');

class CustomAdapter {
    constructor(apiKey, model = 'gpt-oss:20b', baseUrl = '') {
        this.apiKey = apiKey;
        this.model = model;
        this.baseUrl = baseUrl;
        this.messages = [];
    }

    async init() {}

    async *streamMessage() {
        const body = JSON.stringify({
            model: this.model,
            messages: this.messages,
            stream: true
        });

        const url = new URL(this.baseUrl + '/v1/chat/completions');
        const lib = url.protocol === 'https:' ? https : http;

        const chunks = await new Promise((resolve, reject) => {
            const req = lib.request({
                hostname: url.hostname,
                port: url.port || (url.protocol === 'https:' ? 443 : 80),
                path: url.pathname + url.search,
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(body),
                    ...(this.apiKey && { 'Authorization': `Bearer ${this.apiKey}` })
                }
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
                if (!data || data === '[DONE]') continue;
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

module.exports = { CustomAdapter };
