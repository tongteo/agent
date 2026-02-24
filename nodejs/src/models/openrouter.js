const axios = require('axios');

class OpenRouterAdapter {
    constructor(apiKey, model = 'arcee-ai/trinity-large-preview:free') {
        this.apiKey = apiKey;
        this.model = model;
        this.messages = [];
    }

    async init() {
        // No initialization needed for API
    }

    async *streamMessage() {
        const response = await axios.post('https://openrouter.ai/api/v1/chat/completions', {
            model: this.model,
            messages: this.messages,
            stream: true
        }, {
            headers: {
                'Authorization': `Bearer ${this.apiKey}`,
                'Content-Type': 'application/json'
            },
            responseType: 'stream'
        });

        let fullContent = '';
        let buffer = '';
        
        for await (const chunk of response.data) {
            buffer += chunk.toString();
            const lines = buffer.split('\n');
            buffer = lines.pop() || ''; // Keep incomplete line in buffer
            
            for (const line of lines) {
                if (line.startsWith('data: ')) {
                    const data = line.slice(6).trim();
                    
                    if (data === '[DONE]') continue;
                    if (!data) continue;
                    
                    try {
                        const parsed = JSON.parse(data);
                        const content = parsed.choices?.[0]?.delta?.content;
                        
                        if (content) {
                            fullContent += content;
                            yield content;
                        }
                    } catch (e) {
                        // Skip invalid JSON
                    }
                }
            }
        }
        
        this.messages.push({ role: 'assistant', content: fullContent });
    }

    reset() {
        this.messages = [];
    }
}

module.exports = { OpenRouterAdapter };
