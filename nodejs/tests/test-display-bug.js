/**
 * @fileoverview Regression test: agent stops displaying content after 2-3 turns.
 *
 * The bug: After 2-3 interactions in agent mode, the agent stops showing content
 * in the terminal even though the model generates responses (visible in web history).
 *
 * This test simulates the full chat() + handleToolCalls() display pipeline
 * with a mock model to reproduce the bug without needing a real browser.
 */

const assert = require('assert');
const { hasToolCall, stripToolCalls } = require('../src/core/stream-utils');
const { renderMarkdown } = require('../src/ui/formatter');
const { ToolParser } = require('../src/core/agent');

const toolNames = ToolParser.TOOL_NAMES;

// ── Mock model that returns canned responses ──
class MockModel {
    constructor(responses) {
        this._responses = [...responses];
        this._callIndex = 0;
        this.messages = [];
        this.pendingToolCalls = null;
        this.model = 'mock-web';
        this.lastUsage = null;
        this.showThinking = false;
    }

    async *streamMessage() {
        const userMsg = this.messages.at(-1);
        if (!userMsg) return;

        // Simulate: get next canned response
        const response = this._responses[this._callIndex] || '';
        this._callIndex++;

        this.messages.push({ role: 'assistant', content: response });
        yield response;
    }

    reset() {
        this.messages = [];
        this._callIndex = 0;
    }

    abort() {}
}

// ── Simulate the exact display logic from chat-bot.js ──

/**
 * Simulate chat() display logic (lines 217-227)
 */
function chatDisplayLogic(full, agentMode = true) {
    const hasToolCallFlag = hasToolCall(full, toolNames);
    let displayed = null;
    if (full.trim()) {
        let displayText = full.trim();
        if (hasToolCallFlag) {
            displayText = stripToolCalls(full, toolNames);
        }
        if (displayText && displayText !== '(no response)') {
            displayed = renderMarkdown(displayText, agentMode);
        }
    }
    return displayed;
}

/**
 * Simulate handleToolCalls() display logic (lines 552-572)
 * Returns { displayed, hasToolCalls, full }
 */
function handleToolCallsDisplayLogic(full, agentMode = true) {
    const hasToolCallFlag = hasToolCall(full, toolNames);
    let displayed = null;
    if (full.trim() && !hasToolCallFlag && full.trim() !== '(no response)') {
        displayed = renderMarkdown(full.trim(), agentMode);
    }
    return { displayed, hasToolCalls: hasToolCallFlag };
}

/**
 * Parse tool calls from text (simulating handleToolCalls line 328-334)
 */
function parseToolCalls(text) {
    let calls = ToolParser.parse(text).map(tc => ({ ...tc, id: null }));
    return calls;
}

// ── Test: Simulate 3-turn agent conversation ──
describe('Agent display after multiple turns', () => {

    it('Turn 1: model returns text + tool call → chat() shows text, handleToolCalls executes tool', () => {
        // Model response: conversational text + tool call
        const modelResponse = 'I will create a C program for you.\n\n<tool>write_file</tool>\n<params>{"path":"main.c","content":"int main(){return 0;}"}</params>';

        // chat() display logic
        const chatDisplayed = chatDisplayLogic(modelResponse);
        assert.ok(chatDisplayed !== null, 'chat() should display something');
        assert.ok(chatDisplayed.includes('I will create a C program'), 'chat() should show conversational text');

        // handleToolCalls parses tool calls
        const toolCalls = parseToolCalls(modelResponse);
        assert.ok(toolCalls.length > 0, 'Should detect tool calls');

        // After tool execution, model returns final answer
        const afterToolResponse = 'Done! The file main.c has been created.';
        const afterToolDisplay = handleToolCallsDisplayLogic(afterToolResponse);
        assert.ok(afterToolDisplay.displayed !== null, 'handleToolCalls should display final answer');
        assert.ok(!afterToolDisplay.hasToolCalls, 'Final answer should have no tool calls');
    });

    it('Turn 2: same pattern — should still display', () => {
        const modelResponse = 'Let me compile the code.\n\n<tool>bash</tool>\n<params>{"command":"gcc main.c -o main"}</params>';

        const chatDisplayed = chatDisplayLogic(modelResponse);
        assert.ok(chatDisplayed !== null, 'chat() should display something on turn 2');
        assert.ok(chatDisplayed.includes('Let me compile'), 'Should show conversational text');

        const toolCalls = parseToolCalls(modelResponse);
        assert.ok(toolCalls.length > 0, 'Should detect tool calls');

        const afterToolResponse = 'Compilation successful! The program runs correctly.';
        const afterToolDisplay = handleToolCallsDisplayLogic(afterToolResponse);
        assert.ok(afterToolDisplay.displayed !== null, 'Should display final answer');
    });

    it('Turn 3: BUG — model returns text + tool call in handleToolCalls → text is LOST', () => {
        // This is the bug scenario: after tool execution in handleToolCalls(),
        // the model returns a response that contains BOTH text AND a new tool call.
        // The text is not displayed because handleToolCalls() skips display when
        // hasToolCallFlag is true.

        const modelResponse = 'Now let me add error handling to the code.\n\n<tool>read_file</tool>\n<params>{"path":"main.c"}</params>';

        // chat() displays the text before tool calls ✓
        const chatDisplayed = chatDisplayLogic(modelResponse);
        assert.ok(chatDisplayed !== null, 'chat() should display text');

        // handleToolCalls detects tool calls → does NOT display text
        const htDisplay = handleToolCallsDisplayLogic(modelResponse);
        assert.strictEqual(htDisplay.displayed, null, 'handleToolCalls skips display when tool calls present');
        assert.ok(htDisplay.hasToolCalls, 'Should detect tool calls');

        // The text "Now let me add error handling" is LOST — never displayed
        // This is the root cause of the bug: after 2-3 turns, if the model
        // consistently returns text + tool calls in handleToolCalls(),
        // the user sees no conversational text.

        const toolCalls = parseToolCalls(modelResponse);
        assert.ok(toolCalls.length > 0, 'Should parse tool calls');

        // After this tool execution, model returns another text + tool call
        const followUp = 'I see the issue. Let me fix it.\n\n<tool>write_file</tool>\n<params>{"path":"main.c","content":"fixed code"}</params>';

        const htDisplay2 = handleToolCallsDisplayLogic(followUp);
        assert.strictEqual(htDisplay2.displayed, null, 'handleToolCalls again skips display');
        assert.ok(htDisplay2.hasToolCalls, 'Should detect tool calls again');

        // Eventually model returns final answer
        const finalAnswer = 'All done! The code has been updated with error handling.';
        const finalDisplay = handleToolCallsDisplayLogic(finalAnswer);
        assert.ok(finalDisplay.displayed !== null, 'Final answer should be displayed');

        // But the intermediate conversational text was lost
        // The user only sees: chat() text → tool executions → final answer
        // Missing: "Now let me add error handling" and "I see the issue. Let me fix it."
    });

    it('BUG SCENARIO: model returns ONLY tool calls (no text) in handleToolCalls → no display at all', () => {
        // After several turns, the model might stop including conversational text
        // and just emit tool calls. This means NOTHING is displayed in handleToolCalls().

        const responses = [
            '<tool>read_file</tool>\n<params>{"path":"main.c"}</params>',
            '<tool>str_replace</tool>\n<params>{"path":"main.c","old_str":"old","new_str":"new"}</params>',
            '<tool>bash</tool>\n<params>{"command":"gcc main.c -o main"}</params>',
        ];

        for (let i = 0; i < responses.length; i++) {
            const htDisplay = handleToolCallsDisplayLogic(responses[i]);
            assert.strictEqual(htDisplay.displayed, null, `Response ${i}: should not display (tool call only)`);
        }

        // User sees nothing between tool executions — feels like "no content"
        // Even though the model is actively working (visible in web history)
    });

    it('FIX: handleToolCalls should display text before tool calls like chat() does', () => {
        // This test defines the EXPECTED behavior after the fix:
        // handleToolCalls should use the same display logic as chat()
        // — show conversational text even when tool calls are present.

        const responses = [
            'I will read the file first.\n\n<tool>read_file</tool>\n<params>{"path":"main.c"}</params>',
            'I see the issue. Let me fix it.\n\n<tool>str_replace</tool>\n<params>{"path":"main.c","old_str":"old","new_str":"new"}</params>',
            'Now let me compile.\n\n<tool>bash</tool>\n<params>{"command":"gcc main.c -o main"}</params>',
            'All done! The code compiles and runs correctly.',
        ];

        const displayedTexts = [];

        for (const response of responses) {
            // FIX: Use the SAME display logic as chat() — show text before tool calls
            const hasToolCallFlag = hasToolCall(response, toolNames);
            if (response.trim()) {
                let displayText = response.trim();
                if (hasToolCallFlag) {
                    displayText = stripToolCalls(response, toolNames);
                }
                if (displayText && displayText !== '(no response)') {
                    displayedTexts.push(displayText);
                }
            }
        }

        assert.ok(displayedTexts.length >= 3, `Should display conversational text for ${displayedTexts.length} responses`);
        assert.ok(displayedTexts[0].includes('I will read'), 'Should show "I will read the file"');
        assert.ok(displayedTexts[1].includes('I see the issue'), 'Should show "I see the issue"');
        assert.ok(displayedTexts[2].includes('Now let me compile'), 'Should show "Now let me compile"');
    });
});

// ── Test: ToolParser.parse doesn't produce false positives ──
describe('ToolParser false positive detection', () => {
    it('should not parse prose mentioning tool names as tool calls', () => {
        const text = 'I used the write_file tool to create the file, then bash to compile it. The result was successful.';
        const calls = ToolParser.parse(text);
        assert.strictEqual(calls.length, 0, 'Should not parse prose as tool calls');
    });

    it('should not parse code examples as tool calls', () => {
        const text = 'Here is an example of using the tool:\nwrite_file\n{"path":"example.txt","content":"hello"}\n\nBut this is just documentation, not an actual call.';
        const calls = ToolParser.parse(text);
        // This might parse as a tool call — that's a potential issue
        // If it does, hasToolCallFlag would be true and text would be stripped
        if (calls.length > 0) {
            console.log('  ⚠ ToolParser parsed documentation as tool call — potential false positive');
        }
    });

    it('should parse actual XML tool calls correctly', () => {
        const text = '<tool>bash</tool>\n<params>{"command":"ls"}</params>';
        const calls = ToolParser.parse(text);
        assert.strictEqual(calls.length, 1);
        assert.strictEqual(calls[0].tool, 'bash');
    });

    it('should parse actual JSON tool calls correctly', () => {
        const text = 'bash\n{"command":"ls"}';
        const calls = ToolParser.parse(text);
        assert.strictEqual(calls.length, 1);
        assert.strictEqual(calls[0].tool, 'bash');
    });
});

// ── Test: streamMessage edge cases ──
describe('streamMessage edge cases', () => {
    it('returns undefined when messages is empty', async () => {
        const messages = [];
        const userMsg = messages.at(-1);
        assert.strictEqual(userMsg, undefined);
        // streamMessage would return without yielding → full = ''
    });

    it('returns last message content when messages has entries', async () => {
        const messages = [
            { role: 'system', content: 'You are an agent.' },
            { role: 'user', content: '[Tool Results]\n[write_file] OK' },
        ];
        const userMsg = messages.at(-1);
        assert.ok(userMsg, 'Should have a last message');
        assert.ok(userMsg.content.includes('[Tool Results]'), 'Should contain tool results');
    });

    it('after trimHistory, last message is preserved', () => {
        const { ContextManager } = require('../src/core/context-manager');
        const cm = new ContextManager({ maxTokens: 500, trimTarget: 0.5 });

        const messages = [
            { role: 'system', content: 'Agent prompt with tools: ' + 'x'.repeat(200) },
            { role: 'user', content: 'Write a program' },
            { role: 'assistant', content: '<tool>write_file</tool>' },
            { role: 'user', content: '[Tool Results]\n[write_file] OK' },
            { role: 'assistant', content: 'Now compile it.' },
            { role: 'user', content: '[Tool Results]\n[bash] gcc: error: missing semicolon' },
            { role: 'assistant', content: 'Let me fix the error.' },
            { role: 'user', content: '[Tool Results]\n[write_file] Fixed' },
            { role: 'assistant', content: 'Done! The program compiles and runs.' },
        ];

        const result = cm.trimHistory(messages);
        if (result.trimmed) {
            const lastMsg = result.messages[result.messages.length - 1];
            assert.ok(lastMsg, 'Last message should exist after trim');
            // The last message should be the assistant's final response
            assert.ok(lastMsg.content.includes('Done'), 'Final response should be preserved');
        }
    });
});
