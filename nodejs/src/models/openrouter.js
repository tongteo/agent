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
            messages: this.messages
        }, {
            headers: {
                'Authorization': `Bearer ${this.apiKey}`,
                'Content-Type': 'application/json'
            }
        });

        const content = response.data.choices[0].message.content;
        this.messages.push({ role: 'assistant', content });
        
        // Yield content in chunks for visual effect
        const chunkSize = 50;
        for (let i = 0; i < content.length; i += chunkSize) {
            yield content.slice(i, i + chunkSize);
        }
    }

    reset() {
        this.messages = [];
    }
}

module.exports = { OpenRouterAdapter };
