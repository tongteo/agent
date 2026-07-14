/**
 * @fileoverview Utility functions for tool operations.
 * Provides sanitization, command resolution, and shell quoting helpers.
 */

const { execFileSync } = require('child_process');
const path = require('path');
const os = require('os');

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

/**
 * Resolve a file path and verify it stays within the allowed directory.
 * Prevents path traversal attacks (../../etc/passwd) and symlink escapes.
 * @param {string} filePath - User-supplied path (may be relative, may contain ~)
 * @param {string} [allowedRoot] - Directory the path must stay within
 * @returns {{ ok: boolean, resolved: string, error?: string }}
 */
function sandboxPath(filePath, allowedRoot) {
    const root = allowedRoot || process.cwd();
    // Expand ~ to home directory
    const homedir = os.homedir();
    const expanded = filePath.startsWith('~/') ? path.join(homedir, filePath.slice(2)) : filePath;
    const resolved = path.resolve(root, expanded);

    // Check containment (resolved must be under root, or under home for ~/ paths)
    const underRoot = resolved.startsWith(root + path.sep) || resolved === root;
    const underHome = resolved.startsWith(homedir + path.sep) || resolved === homedir;
    if (!underRoot && !underHome) {
        return { ok: false, resolved, error: `Path escapes sandbox: ${filePath} resolves outside allowed directory` };
    }

    // Reject null bytes (can bypass string checks)
    if (resolved.includes('\0') || filePath.includes('\0')) {
        return { ok: false, resolved, error: 'Path contains null bytes' };
    }

    return { ok: true, resolved };
}

/**
 * Block obviously destructive shell commands that bypass the validator.
 * Defense-in-depth: the validator catches most cases, this catches edge cases
 * in the bash tool where model output goes directly to execSync.
 * @param {string} command - Shell command string
 * @returns {{ safe: boolean, reason?: string }}
 */
function checkCommandSafety(command) {
    const trimmed = command.trim();
    // Strip comments and surrounding quotes for analysis
    const cleaned = trimmed.replace(/#.*$/, '').replace(/^['"]|['"]$/g, '');

    // Destructive filesystem operations
    const destructive = [
        { re: /\brm\s+(-[rRf]+\s+)?\/\s/, reason: 'rm on root filesystem' },
        { re: /\brm\s+(-[rRf]+\s+)\/etc\b/, reason: 'rm on /etc' },
        { re: /\brm\s+(-[rRf]+\s+)\/var\b/, reason: 'rm on /var' },
        { re: /\brm\s+(-[rRf]+\s+)\/usr\b/, reason: 'rm on /usr' },
        { re: /\brm\s+(-[rRf]+\s+)\/bin\b/, reason: 'rm on /bin' },
        { re: /\bmkfs\b/, reason: 'format filesystem' },
        { re: /\bdd\s+if=\/dev\/(sd|vd|nvme)/, reason: 'dd on disk device' },
        { re: /\b:(){ :\|:& };:/, reason: 'fork bomb' },
        { re: /\bchmod\s+(-R\s+)?777\s+\/\s*$/, reason: 'chmod 777 on root' },
    ];

    for (const { re, reason } of destructive) {
        if (re.test(cleaned)) {
            return { safe: false, reason };
        }
    }

    return { safe: true };
}

module.exports = {
    IS_WINDOWS,
    sanitizeToolOutput,
    commandExists,
    resolvePython,
    quoteArg,
    buildCmd,
    LANG_MAP,
    sandboxPath,
    checkCommandSafety
};
