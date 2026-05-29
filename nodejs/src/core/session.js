const os = require('os');
const fs = require('fs');
const path = require('path');

class SessionManager {
    constructor(sessionFile = path.join(os.homedir(), '.chatgpt-cli-session.json')) {
        this.sessionFile = sessionFile;
        this.workingDir = process.cwd();
        this.envVars = { ...process.env };
    }

    save() {}

    load() {}

    reset() {
        this.workingDir = process.cwd();
        this.envVars = { ...process.env };
        this.allowAll = false;
    }
}

module.exports = { SessionManager };
