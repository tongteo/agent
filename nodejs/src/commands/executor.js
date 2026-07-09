/**
 * @fileoverview Command executor — runs shell commands with session-aware working dir,
 * cd/export handling, and interactive (node-pty) support.
 */

const { execSync } = require('child_process');
const os = require('os');
const fs = require('fs');
const path = require('path');
const chalk = require('chalk');

let pty;
try {
    pty = require('node-pty');
} catch (e) {
    // Optional dependency
}

class CommandExecutor {
    /**
     * @param {import('../core/session').SessionManager} session - Session manager
     */
    constructor(session) {
        /** @type {import('../core/session').SessionManager} */
        this.session = session;
        /** @type {string} */
        this.shell = this.getShell();
    }

    /**
     * Get the system shell path.
     * @returns {string} Shell executable path
     */
    getShell() {
        if (process.platform === 'win32') {
            return process.env.ComSpec || 'cmd.exe';
        }
        return '/bin/bash';
    }

    /**
     * Execute a shell command and return output.
     * Built-in handling for `cd` and `export` commands.
     * @param {string} command - Shell command to run
     * @returns {string} Command output
     */
    execute(command) {
        try {
            const cdMatch = command.match(/^\s*cd\s+([^&|;]+)$/);
            if (cdMatch) return this.handleCd(cdMatch[1]);

            const exportMatch = command.match(/^\s*export\s+(\w+)=(.+)$/);
            if (exportMatch) return this.handleExport(exportMatch[1], exportMatch[2]);

            const isPackageManager = /^\s*(pkg|apt|apt-get|brew|pip|pip3|npm|yarn|cargo)\s/.test(command);
            const output = execSync(command, {
                encoding: 'utf-8',
                cwd: this.session.workingDir,
                env: { ...this.session.envVars, TERM: 'xterm-256color' },
                timeout: isPackageManager ? 120000 : 30000,
                shell: this.shell,
                maxBuffer: 10 * 1024 * 1024
            });
            return output || '(command completed successfully)';
        } catch (error) {
            return `Error (exit code ${error.status || 'unknown'}):\n${error.stderr || error.message}`;
        }
    }

    /**
     * Handle `cd <dir>` — change working directory in session.
     * @param {string} targetDir - Directory to change to
     * @returns {string} Status message
     */
    handleCd(targetDir) {
        targetDir = targetDir.trim().replace(/^['"]|['"]$/g, '');

        if (targetDir.startsWith('~')) {
            targetDir = targetDir.replace('~', os.homedir());
        }

        if (!path.isAbsolute(targetDir)) {
            targetDir = path.resolve(this.session.workingDir, targetDir);
        }

        if (fs.existsSync(targetDir) && fs.statSync(targetDir).isDirectory()) {
            this.session.workingDir = targetDir;
            this.session.save();
            return `Changed directory to: ${this.session.workingDir}`;
        } else {
            return `Error: Directory not found: ${targetDir}`;
        }
    }

    /**
     * Handle `export VAR=value` — set environment variable in session.
     * @param {string} varName - Variable name
     * @param {string} varValue - Variable value
     * @returns {string} Status message
     */
    handleExport(varName, varValue) {
        varValue = varValue.trim().replace(/^['"]|['"]$/g, '');
        this.session.envVars[varName] = varValue;
        this.session.save();
        return `Exported: ${varName}=${varValue}`;
    }

    /**
     * Execute an interactive command using node-pty.
     * Falls back to error message if node-pty is not installed.
     * @param {string} command - Command to run interactively
     * @param {import('../ui/prompt').PromptManager} promptManager - Prompt manager
     * @returns {Promise<string>} Output of interactive session
     */
    async executeInteractive(command, promptManager) {
        if (!pty) {
            return 'Error: node-pty not installed. Run: npm install node-pty';
        }

        return new Promise((resolve) => {
            console.log(chalk.cyan('\n🔄 Starting interactive session... (Ctrl+D to end)\n'));

            if (promptManager && promptManager.close) {
                promptManager.close();
            }

            const shellArgs = process.platform === 'win32' ? ['/c', command] : ['-c', command];
            const shell = pty.spawn(this.shell, shellArgs, {
                name: 'xterm-color',
                cols: process.stdout.columns || 80,
                rows: process.stdout.rows || 24,
                cwd: this.session.workingDir,
                env: { ...this.session.envVars, TERM: 'xterm-256color' }
            });

            let output = '';
            shell.on('data', (data) => {
                process.stdout.write(data);
                output += data;
            });

            process.stdin.setRawMode(true);
            process.stdin.resume();
            const onData = (data) => {
                if (data[0] === 4) { shell.kill(); return; }
                shell.write(data);
            };
            process.stdin.on('data', onData);

            shell.on('exit', () => {
                process.stdin.setRawMode(false);
                process.stdin.pause();
                process.stdin.removeListener('data', onData);

                if (promptManager) promptManager.init();

                console.log(chalk.cyan('\n✓ Interactive session ended\n'));
                resolve(output || '(interactive session completed)');
            });
        });
    }
}

module.exports = { CommandExecutor };
