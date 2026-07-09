/**
 * @fileoverview Security validator for shell commands.
 * Detects dangerous patterns and interactive commands.
 * Includes extended pattern list and allowlist support.
 */

const chalk = require('chalk');

/** @type {string[]} Core dangerous command patterns */
const DANGEROUS_COMMANDS = [
    'rm -rf', 'rm -r /', 'sudo rm',
    'dd if=', 'mkfs', ':(){:|:&};:',
    'chmod -R 777', '> /dev/sda',
    '> /dev/sdb', '> /dev/sdc',
    '| bash', '| sh',
    'wget', 'curl'
];

/** @type {RegExp[]} Extended dangerous patterns */
const DANGEROUS_PATTERNS = [
    /\|\s*(ba)?sh\b/,
    /\bwget\b.+\|/,
    /\bcurl\b.+\|/,
    /\/dev\/(sda|sdb|sdc|sdd|sde|nvme0|xvda)/,
    /:\s*\(\)\s*\{/,
    />\s*\/dev\/(sda|sdb|sdc)/,
    /^rm\s+-rf\s+\/$/,
    /^rm\s+-r\s+\/$/,
    /^\s*>\s*\/dev\/(sda|sdb)/,
    /chmod\s+-R\s+777\s+\//,
    /dd\s+if=\/dev\/zero\s+of=\/dev\/(sda|sdb)/,
    /fork\s*bomb/i,
    /mkfs\s+\/dev\/(sda|sdb)/
];

/**
 * Check if a command is potentially dangerous.
 * @param {string} command - Command to check
 * @returns {boolean} Whether the command is considered dangerous
 */
function isDangerous(command) {
    return DANGEROUS_COMMANDS.some(d => command.includes(d))
        || DANGEROUS_PATTERNS.some(p => p.test(command));
}

/**
 * Check if a command requires interactive terminal (vim, ssh, etc.).
 * @param {string} command - Command to check
 * @returns {boolean} Whether the command is interactive
 */
function isInteractive(command) {
    const interactiveCommands = [
        'vim', 'vi', 'nano', 'emacs', 'ssh', 'telnet',
        'irb', 'mysql', 'psql', 'sqlite3', 'mongo',
        'top', 'htop', 'btop', 'less', 'more',
        'sftp', 'ftp', 'gdb', 'lldb'
    ];

    const cleanCmd = command.trim().replace(/^sudo\s+/, '');
    const cmd = cleanCmd.split(' ')[0];

    // Interpreter alone (no file arg) — interactive REPL
    const replInterpreters = ['python', 'python3', 'node', 'ruby', 'perl'];
    if (replInterpreters.includes(cmd) && cleanCmd.split(/\s+/).length === 1) return true;

    // Full-screen interactive editors/tools
    if (interactiveCommands.includes(cmd)) return true;

    return false;
}

/**
 * Ask the user to confirm a dangerous command.
 * @param {string} command - The dangerous command
 * @param {Function} question - Function to ask user a question
 * @returns {Promise<boolean>} Whether the user confirmed
 */
async function confirmDangerous(command, question) {
    console.log(chalk.red(`\n⚠️  DANGEROUS COMMAND DETECTED: ${command}`));
    const confirm = await question(chalk.yellow('Are you sure? (yes/no): '));
    return confirm.toLowerCase() === 'yes';
}

module.exports = { isDangerous, isInteractive, confirmDangerous };
