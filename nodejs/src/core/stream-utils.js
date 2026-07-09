/**
 * @fileoverview Stream utilities — spinner, SIGINT handling, SIGINT lifecycle.
 * Reduces boilerplate in chat-bot.js and handleToolCalls.
 */

const chalk = require('chalk');

/**
 * Spinner characters for progress indication.
 * @type {string[]}
 */
const SPINNER_CHARS = ['\u280b', '\u2819', '\u2839', '\u2838', '\u283c', '\u2834', '\u2826', '\u2827', '\u2807', '\u280f'];

/**
 * Start a spinner interval. Returns the interval handle.
 * @param {string} prefix - Text to show before spinner
 * @returns {NodeJS.Timeout}
 */
function startSpinner(prefix = '') {
    let si = 0;
    return setInterval(() => process.stdout.write(`\r${chalk.dim(SPINNER_CHARS[si++ % SPINNER_CHARS.length])}`), 80);
}

/**
 * Stop spinner and clear the line.
 * @param {NodeJS.Timeout} interval
 */
function stopSpinner(interval) {
    clearInterval(interval);
    process.stdout.write('\r\x1b[K');
}

/**
 * Install a temporary SIGINT handler and return the cleanup function.
 * @param {Function} handler - SIGINT handler
 * @param {Object} [prompt] - Optional PromptManager with _sigintDefault
 * @returns {Function} Cleanup function
 */
function withSigint(handler, prompt) {
    if (prompt && prompt._sigintDefault) {
        process.removeListener('SIGINT', prompt._sigintDefault);
    }
    process.once('SIGINT', handler);
    return () => {
        process.removeListener('SIGINT', handler);
        if (prompt && prompt._sigintDefault) {
            process.addListener('SIGINT', prompt._sigintDefault);
        }
    };
}

/**
 * Create a streaming timeout that aborts the operation after N ms.
 * @param {number} ms - Timeout in milliseconds
 * @param {Function} abortFn - Function to call to abort
 * @param {string} [label] - Optional timeout label for log
 * @returns {NodeJS.Timeout}
 */
function createStreamTimeout(ms, abortFn, label = 'Stream') {
    return setTimeout(() => {
        abortFn();
        console.log(chalk.yellow(`\n\u26a0\uFE0F  ${label} timeout (${ms / 1000}s)\n`));
    }, ms);
}

/**
 * Compile RegExp for tool name matching from an array of names.
 * @param {string[]} toolNames
 * @returns {RegExp} RegExp matching "toolName\n{" or inline "toolName {"
 */
function buildToolCallRegex(toolNames) {
    const escaped = toolNames.map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
    return new RegExp('^(?:' + escaped + ')\\s*\n\{', 'm');
}

/**
 * Strip XML tool tags and JSON-format tool calls from text for display.
 * @param {string} text - Raw model response
 * @param {string[]} toolNames - Known tool names
 * @returns {string} Clean display text
 */
function stripToolCalls(text, toolNames) {
    let cleaned = text.replace(/<tool>[\s\S]*$/i, '').trim();
    const escaped = toolNames.map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
    // Match toolName then whitespace+{ and everything after (multiline safe)
    const jsonRe = new RegExp('(?:' + escaped + ')\\s*\\{[\\s\\S]*$', 'm');
    cleaned = cleaned.replace(jsonRe, '').trim();
    return cleaned;
}

/**
 * Check if text contains any tool call markers.
 * @param {string} text - Model response
 * @param {string[]} toolNames - Known tool names
 * @param {number} [pendingToolCalls] - Pending native function calls
 * @returns {boolean}
 */
function hasToolCall(text, toolNames, pendingToolCalls) {
    const jsonToolRe = buildToolCallRegex(toolNames);
    return text.includes('<tool>') ||
           text.includes('&lt;tool&gt;') ||
           text.includes('<longcat_tool_call>') ||
           text.includes('TOOL_CALL:') ||
           (pendingToolCalls && pendingToolCalls.length > 0) ||
           jsonToolRe.test(text.trim());
}

module.exports = {
    SPINNER_CHARS,
    startSpinner,
    stopSpinner,
    withSigint,
    createStreamTimeout,
    buildToolCallRegex,
    stripToolCalls,
    hasToolCall
};
