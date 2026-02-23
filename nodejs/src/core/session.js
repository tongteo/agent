const os = require('os');
const fs = require('fs');
const path = require('path');

class SessionManager {
    constructor(sessionFile = path.join(os.homedir(), '.chatgpt-cli-session.json')) {
        this.sessionFile = sessionFile;
        this.workingDir = process.cwd();
        this.envVars = { ...process.env };
    }

    save() {
        try {
            const session = {
                workingDir: this.workingDir,
                envVars: this.envVars,
                timestamp: new Date().toISOString()
            };
            fs.writeFileSync(this.sessionFile, JSON.stringify(session, null, 2));
        } catch (e) {
            // Silent fail
        }
    }

    load() {
        try {
            if (fs.existsSync(this.sessionFile)) {
                const session = JSON.parse(fs.readFileSync(this.sessionFile, 'utf-8'));
                if (session.workingDir && fs.existsSync(session.workingDir)) {
                    this.workingDir = session.workingDir;
                }
                if (session.envVars) {
                    this.envVars = { ...process.env, ...session.envVars };
                }
            }
        } catch (e) {
            // Silent fail
        }
    }

    reset() {
        this.workingDir = process.cwd();
        this.envVars = { ...process.env };
        this.save();
    }
}

module.exports = { SessionManager };
