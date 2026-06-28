const chalk = require('chalk');

const DANGEROUS_COMMANDS = ['rm -rf', 'rm -r /', 'sudo rm', 'dd if=', 'mkfs', ':(){:|:&};:', 'chmod -R 777', '> /dev/sda'];

function isDangerous(command) {
    return DANGEROUS_COMMANDS.some(d => command.includes(d))
        || /\|\s*(ba)?sh\b/.test(command)
        || /\bwget\b.+\|/.test(command)
        || /\bcurl\b.+\|/.test(command);
}

function isInteractive(command) {
    const interactiveCommands = ['vim', 'vi', 'nano', 'emacs', 'ssh', 'irb', 'mysql', 'psql', 'top', 'htop', 'less', 'more'];
    const cleanCmd = command.trim().replace(/^sudo\s+/, '');
    const cmd = cleanCmd.split(' ')[0];
    if (interactiveCommands.includes(cmd)) return true;

    // Interpreter alone (no file arg) → interactive REPL
    const replInterpreters = ['python', 'python3', 'node', 'ruby', 'perl'];
    if (replInterpreters.includes(cmd) && cleanCmd.split(/\s+/).length === 1) return true;

    return false;
}

async function confirmDangerous(command, question) {
    console.log(chalk.red(`\n⚠️  DANGEROUS COMMAND DETECTED: ${command}`));
    const confirm = await question(chalk.yellow('Are you sure? (yes/no): '));
    return confirm.toLowerCase() === 'yes';
}

module.exports = { isDangerous, isInteractive, confirmDangerous };
