/**
 * @fileoverview Utility functions for tool operations.
 * Provides sanitization, command resolution, and shell quoting helpers.
 */

const { execFileSync } = require('child_process');

/** @type {boolean} */
const IS_WINDOWS = process.platform === 'win32';

/** @type {RegExp} Tags that could be mistaken for system prompt injection */
const INJECTION_TAG_RE = /<(\/?)(system_reminder|system|developer|admin|instruction|sudo|tool_result|past_tool_use|project_instructions)\b([^>]*)>/gi;

/**
 * Neutralize prompt-injection payloads that may appear in tool output
 * (e.g. file contents, shell stdout, web page text).
 * @param {*} text - Raw text to sanitize
 * @returns {*} Sanitized text with dangerous tags escaped
 */
function sanitizeToolOutput(text) {
    if (text == null) return text;
    if (typeof text !== 'string') {
        try { text = String(text); } catch { return text; }
    }
    return text
        .replace(INJECTION_TAG_RE, '&lt;$1$2$3&gt;')
        .replace(/\[SYSTEM:/gi, '[SYSTEM\u200B:')
        .replace(/\[\/?INST\]/gi, m => m.replace('[', '[\u200B'));
}

/**
 * Check if a command exists on the system PATH.
 * @param {string} cmd - Command name to check
 * @returns {boolean} Whether the command is available
 */
function commandExists(cmd) {
    try {
        const probe = IS_WINDOWS ? 'where' : 'which';
        execFileSync(probe, [cmd], { stdio: 'ignore' });
        return true;
    } catch {
        return false;
    }
}

/**
 * Resolve the Python interpreter command.
 * @returns {{ cmd: string, prefixArgs: string[] }} Python command config
 */
function resolvePython() {
    if (IS_WINDOWS) {
        if (commandExists('py')) return { cmd: 'py', prefixArgs: ['-3'] };
        if (commandExists('python')) return { cmd: 'python', prefixArgs: [] };
        return { cmd: 'python3', prefixArgs: [] };
    }
    return { cmd: commandExists('python3') ? 'python3' : 'python', prefixArgs: [] };
}

/**
 * Quote a shell argument appropriately for the platform.
 * @param {string} arg - Argument to quote
 * @returns {string} Quoted argument
 */
function quoteArg(arg) {
    if (arg === '' || arg == null) return '""';
    const s = String(arg);
    if (IS_WINDOWS) {
        if (/[\s"&|<>^()%!]/.test(s)) {
            return '"' + s.replace(/"/g, '\\"') + '"';
        }
        return s;
    }
    if (/[^A-Za-z0-9_\-\/.\-=:]/.test(s)) {
        return "'" + s.replace(/'/g, "'\\''") + "'";
    }
    return s;
}

/**
 * Build a command string from parts, quoting as needed.
 * @param {string[]} parts - Command parts
 * @returns {string} Joined command string
 */
function buildCmd(parts) {
    return parts.map(quoteArg).join(' ');
}

/** @type {Object<string, string>} Language ID map for file extensions */
const LANG_MAP = {
    js: 'javascript', ts: 'typescript',
    py: 'python', rs: 'rust',
    c: 'c', cpp: 'cpp', cc: 'cpp', cxx: 'cpp', h: 'cpp', hpp: 'cpp',
    html: 'html', htm: 'html',
    css: 'css'
};

module.exports = {
    IS_WINDOWS,
    sanitizeToolOutput,
    commandExists,
    resolvePython,
    quoteArg,
    buildCmd,
    LANG_MAP
};
