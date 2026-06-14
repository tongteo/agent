#!/usr/bin/env node
process.env.GEMINI_COOKIES = '1';
process.chdir(process.env.HOME + '/trunh');

const { GeminiCookiesAdapter } = require('./src/models/gemini-cookies');
const { ToolRegistry } = require('./src/core/tools');
const { AgentPrompt, ToolParser, IntentParser } = require('./src/core/agent');
const { SessionManager } = require('./src/core/session');

// Extract ```html ... ``` or ```...``` code blocks from response
function extractCodeBlock(response, ext) {
    const re = new RegExp('```(?:' + ext + ')?\\n([\\s\\S]+?)```', 'i');
    const m = response.match(re);
    return m ? m[1].trim() : null;
}

async function runAgentTurn(adapter, tools, userMsg, turnNum, targetFile) {
    console.log(`\n=== Turn ${turnNum} ===`);
    console.log(`👤 ${userMsg}`);
    adapter.messages.push({ role: 'user', content: userMsg });

    for (let iter = 0; iter < 6; iter++) {
        let response = '';
        for await (const chunk of adapter.streamMessage()) response += chunk;

        let calls = ToolParser.parse(response);
        if (!calls.length) calls = IntentParser.parse(response, {});

        // Fallback: if no tool call but response has a full code block, write to targetFile
        if (!calls.length && targetFile) {
            const ext = targetFile.split('.').pop();
            const code = extractCodeBlock(response, ext) || extractCodeBlock(response, '');
            if (code && code.length > 200) {
                console.log(`  ⚙  write_file ${targetFile} (extracted from code block)`);
                const result = await tools.execute('write_file', { path: targetFile, content: code });
                console.log(`  ✓ written ${code.length} chars`);
                adapter.messages.push({ role: 'assistant', content: response });
                adapter.messages.push({ role: 'user', content: `Tool result:\n${result || 'File written.'}` });
                // get final summary
                let final = '';
                for await (const chunk of adapter.streamMessage()) final += chunk;
                console.log(`${final.trim().substring(0, 300)}`);
                break;
            }
        }

        if (!calls.length) {
            console.log(`${response.trim().substring(0, 500)}`);
            break;
        }

        for (const { tool, params } of calls) {
            const label = params.path || params.command || '';
            console.log(`  ⚙  ${tool} ${label}`);
            const result = await tools.execute(tool, params);
            console.log(`  ✓ ${result.substring(0, 300)}`);
            adapter.messages.push({ role: 'assistant', content: response });
            adapter.messages.push({ role: 'user', content: `Tool result:\n${result}` });
        }
    }
}

(async () => {
    // Clean up previous run
    const fs = require('fs');
    try { fs.unlinkSync(process.env.HOME + '/trunh/clock.html'); } catch {}

    const adapter = new GeminiCookiesAdapter();
    await adapter.init();
    const tools = new ToolRegistry(new SessionManager());
    adapter.messages = [{ role: 'system', content: AgentPrompt.getCompactPrompt(tools) }];

    const turns = [
        ['Create a modern responsive analog clock as a single HTML file called clock.html. Use dark theme, smooth animations, and show digital time below the clock.', 'clock.html'],
        ['Add a date display below the digital time and add glow effects to the clock hands', 'clock.html'],
        ['Add a toggle button in the top-right corner to switch between dark and light theme', 'clock.html'],
        ['List all files in the current directory, then show the first 20 lines of clock.html', null],
    ];

    for (let i = 0; i < turns.length; i++) {
        await runAgentTurn(adapter, tools, turns[i][0], i + 1, turns[i][1]);
    }

    adapter.cleanup();
    const exists = fs.existsSync(process.env.HOME + '/trunh/clock.html');
    console.log(`\n✅ Done. clock.html exists: ${exists}`);
    if (exists) {
        const size = fs.statSync(process.env.HOME + '/trunh/clock.html').size;
        console.log(`   Size: ${size} bytes`);
    }
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
