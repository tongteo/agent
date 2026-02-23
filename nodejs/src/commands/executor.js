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
    constructor(session) {
        this.session = session;
    }

    execute(command) {
        try {
            // Handle cd command
            const cdMatch = command.match(/^\s*cd\s+(.+)$/);
            if (cdMatch) {
                return this.handleCd(cdMatch[1]);
            }
            
            // Handle export command
            const exportMatch = command.match(/^\s*export\s+(\w+)=(.+)$/);
            if (exportMatch) {
                return this.handleExport(exportMatch[1], exportMatch[2]);
            }
            
            const output = execSync(command, { 
                encoding: 'utf-8',
                cwd: this.session.workingDir,
                env: this.session.envVars,
                timeout: 30000,
                shell: '/bin/bash',
                maxBuffer: 10 * 1024 * 1024
            });
            return output || '(command completed successfully)';
        } catch (error) {
            return `Error (exit code ${error.status || 'unknown'}):\n${error.stderr || error.message}`;
        }
    }

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

    handleExport(varName, varValue) {
        varValue = varValue.trim().replace(/^['"]|['"]$/g, '');
        this.session.envVars[varName] = varValue;
        this.session.save();
        return `Exported: ${varName}=${varValue}`;
    }

    async executeInteractive(command, rl) {
        if (!pty) {
            return 'Error: node-pty not installed. Run: npm install node-pty';
        }

        return new Promise((resolve) => {
            console.log(chalk.cyan('\n🔄 Starting interactive session... (Ctrl+D or type "exit" to end)\n'));
            
            rl.pause();
            
            const shell = pty.spawn(command.split(' ')[0], command.split(' ').slice(1), {
                name: 'xterm-color',
                cols: process.stdout.columns || 80,
                rows: process.stdout.rows || 24,
                cwd: this.session.workingDir,
                env: this.session.envVars
            });

            let output = '';

            shell.on('data', (data) => {
                process.stdout.write(data);
                output += data;
            });

            process.stdin.setRawMode(true);
            process.stdin.resume();
            
            const onData = (data) => {
                if (data[0] === 4) {
                    shell.kill();
                    return;
                }
                shell.write(data);
            };

            process.stdin.on('data', onData);

            shell.on('exit', () => {
                process.stdin.setRawMode(false);
                process.stdin.removeListener('data', onData);
                
                setImmediate(() => {
                    if (!rl.closed) {
                        rl.resume();
                    }
                });
                
                console.log(chalk.cyan('\n✓ Interactive session ended\n'));
                resolve(output || '(interactive session completed)');
            });
        });
    }
}

module.exports = { CommandExecutor };
