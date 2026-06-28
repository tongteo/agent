const axios = require('axios');

async function test() {
    const tools = [{
        type: 'function',
        function: {
            name: 'list_dir',
            description: 'List directory. Params: {"path": "."}',
            parameters: {
                type: 'object',
                properties: {
                    path: { type: 'string', description: 'Directory path' }
                }
            }
        }
    }];

    const body = {
        model: 'gemma4',
        messages: [
            { role: 'system', content: 'You are a helpful assistant.' },
            { role: 'user', content: 'Bạn hãy kiểm tra trong thư mục này có những gì?' }
        ],
        stream: false,
        tools: tools
    };

    try {
        const response = await axios.post('http://localhost:11434/api/chat', body);
        console.log('Success:', JSON.stringify(response.data, null, 2));
    } catch (error) {
        if (error.response) {
            console.error('Status:', error.response.status);
            console.error('Data:', error.response.data);
        } else {
            console.error('Error:', error.message);
        }
    }
}

test();
