const os = require('os');
const fs = require('fs');
const path = require('path');

class SessionManager {
    constructor(sessionFile = path.join(os.homedir(), '.chatgpt-cli-session.json')) {
        this.sessionFile = sessionFile;
        this.workingDir = process.cwd();
        this.envVars = { ...process.env };
    }

    save(messages) {
        try {
            fs.writeFileSync(this.sessionFile, JSON.stringify({ workingDir: this.workingDir, messages }, null, 2));
        } catch {}
    }

    load() {
        try {
            const data = JSON.parse(fs.readFileSync(this.sessionFile, 'utf-8'));
            // workingDir intentionally NOT restored — always use cwd at startup
            return data.messages || [];
        } catch {
            return [];
        }
    }

    reset() {
        this.workingDir = process.cwd();
        this.envVars = { ...process.env };
        this.allowAll = false;
    }
}

module.exports = { SessionManager };
