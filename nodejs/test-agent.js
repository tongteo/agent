#!/usr/bin/env node
process.env.GEMINI_COOKIES = '1';
process.chdir(process.env.HOME + '/trunh');

const { GeminiCookiesAdapter } = require('./src/models/gemini-cookies');
const { ToolRegistry } = require('./src/core/tools');
const { AgentPrompt, ToolParser, IntentParser } = require('./src/core/agent');
const { SessionManager } = require('./src/core/session');

async function runAgentTurn(adapter, tools, userMsg, turnNum) {
    console.log(`\n=== Turn ${turnNum} ===`);
    console.log(`👤 ${userMsg}`);
    adapter.messages.push({ role: 'user', content: userMsg });

    for (let iter = 0; iter < 4; iter++) {
        let response = '';
        for await (const chunk of adapter.streamMessage()) response += chunk;

        const calls = ToolParser.parse(response).length
            ? ToolParser.parse(response)
            : IntentParser.parse(response, {});

        if (!calls.length) {
            console.log(`${response.trim()}`);
            break;
        }

        for (const { tool, params } of calls) {
            console.log(`  ⚙  ${tool} ${JSON.stringify(params)}`);
            const result = await tools.execute(tool, params);
            const preview = result.substring(0, 400);
            console.log(`  ✓ ${preview}`);
            adapter.messages.push({ role: 'assistant', content: response });
            adapter.messages.push({ role: 'user', content: `Tool result:\n${result}` });
        }
    }
}

(async () => {
    const adapter = new GeminiCookiesAdapter();
    await adapter.init();
    const tools = new ToolRegistry(new SessionManager());

    adapter.messages = [{ role: 'system', content: AgentPrompt.getCompactPrompt(tools) }];

    const turns = [
        'List files in the current directory',
        'Read the C file you found',
        'Compile and run it',
        'Add a brief comment at the top of the C file explaining what it does',
    ];

    for (let i = 0; i < turns.length; i++) {
        await runAgentTurn(adapter, tools, turns[i], i + 1);
    }

    adapter.cleanup();
    console.log('\n✅ Done.');
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
