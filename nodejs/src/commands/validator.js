const chalk = require('chalk');

const DANGEROUS_COMMANDS = ['rm -rf', 'dd if=', 'mkfs', ':(){:|:&};:', 'chmod -R 777', '> /dev/sda'];

function isDangerous(command) {
    return DANGEROUS_COMMANDS.some(dangerous => command.includes(dangerous));
}

function isInteractive(command) {
    const interactiveCommands = ['vim', 'vi', 'nano', 'emacs', 'ssh', 'python', 'python3', 'node', 'irb', 'mysql', 'psql', 'top', 'htop', 'less', 'more'];
    const cleanCmd = command.trim().replace(/^sudo\s+/, '');
    const cmd = cleanCmd.split(' ')[0];
    if (interactiveCommands.includes(cmd)) return true;

    // Scripts run directly (./foo.py, ./foo.sh) or via interpreter with a file
    if (/\.(py|rb|pl)(['"]?\s|$)/.test(cleanCmd)) return true;

    return false;
}

async function confirmDangerous(command, question) {
    console.log(chalk.red(`\n⚠️  DANGEROUS COMMAND DETECTED: ${command}`));
    const confirm = await question(chalk.yellow('Are you sure? (yes/no): '));
    return confirm.toLowerCase() === 'yes';
}

module.exports = { isDangerous, isInteractive, confirmDangerous };
