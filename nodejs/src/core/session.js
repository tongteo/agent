/**
 * @fileoverview Session persistence — saves/loads working directory and env vars.
 */

const os = require('os');
const fs = require('fs');
const path = require('path');

class SessionManager {
    /**
     * @param {string} [sessionFile] - Path to session file
     */
    constructor(sessionFile = path.join(os.homedir(), '.chatgpt-cli-session.json')) {
        /** @type {string} */
        this.sessionFile = sessionFile;
        /** @type {string} */
        this.workingDir = process.cwd();
        /** @type {Object<string, string>} */
        this.envVars = { ...process.env };
        /** @type {boolean} */
        this.allowAll = false;
    }

    /**
     * Save session state to disk.
     * @param {Array} [messages] - Optional message history to persist
     */
    save(messages) {
        try {
            fs.writeFileSync(this.sessionFile, JSON.stringify({
                workingDir: this.workingDir,
                messages
            }, null, 2));
        } catch { /* silently ignore write errors */ }
    }

    /**
     * Load session state from disk.
     * @returns {Array} Previously saved messages, or empty array
     */
    load() {
        try {
            const data = JSON.parse(fs.readFileSync(this.sessionFile, 'utf-8'));
            // workingDir intentionally NOT restored — always use cwd at startup
            return data.messages || [];
        } catch {
            return [];
        }
    }

    /**
     * Reset session to defaults.
     */
    reset() {
        this.workingDir = process.cwd();
        this.envVars = { ...process.env };
        this.allowAll = false;
    }
}

module.exports = { SessionManager };
