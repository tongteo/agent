const { spawn } = require('child_process');
const path = require('path');
const readline = require('readline');
const fs = require('fs');

const SCRIPT = path.join(process.env.HOME, 'gemini', 'gemini_bridge.py');
const SESSION_FILE = path.join(process.env.HOME, 'gemini', '.session.json');

class GeminiCookiesAdapter {
    constructor() {
        this.model = 'gemini-web';
        this.messages = [];
        this.lastUsage = null;
        this._proc = null;
        this._rl = null;
        this._pending = null; // { resolve, reject }
        this._sentSystem = false;
        this._loadSession();
    }

    _loadSession() {
        try {
            const s = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8'));
            this._convId = s.conv_id || '';
            this._respId = s.resp_id || '';
            this._choiceId = s.choice_id || '';
        } catch {
            this._convId = '';
            this._respId = '';
            this._choiceId = '';
        }
    }

    _saveSession() {
        fs.writeFileSync(SESSION_FILE, JSON.stringify({
            conv_id: this._convId,
            resp_id: this._respId,
            choice_id: this._choiceId
        }));
    }

    async init() {
        await this._startBridge();
    }

    _startBridge() {
        return new Promise((resolve, reject) => {
            this._proc = spawn('python3', [SCRIPT]);
            this._proc.on('error', reject);
            this._proc.stderr.on('data', () => {}); // suppress

            this._rl = readline.createInterface({ input: this._proc.stdout });
            this._rl.on('line', line => {
                if (!line.trim()) return;
                let msg;
                try { msg = JSON.parse(line); } catch { return; }
                if (msg.ready) { resolve(); return; }
                if (this._pending) {
                    const { resolve: res, reject: rej } = this._pending;
                    this._pending = null;
                    if (msg.error) rej(new Error(msg.error));
                    else res(msg);
                }
            });
            this._proc.on('close', () => {
                if (this._pending) {
                    this._pending.reject(new Error('Bridge process exited'));
                    this._pending = null;
                }
            });
        });
    }

    _send(payload) {
        return new Promise((resolve, reject) => {
            this._pending = { resolve, reject };
            this._proc.stdin.write(JSON.stringify(payload) + '\n');
        });
    }

    async *streamMessage() {
        const userMsg = this.messages.at(-1);
        if (!userMsg) return;

        const systemMsg = this.messages.find(m => m.role === 'system');
        const isNewSession = !this._convId;
        const isFirstNodeTurn = !this._sentSystem;

        // Build conversation history (exclude system, exclude last user msg)
        const history = this.messages
            .filter(m => m.role !== 'system' && m !== userMsg)
            .map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
            .join('\n');

        let text = userMsg.content;
        if (systemMsg && (isNewSession || isFirstNodeTurn)) {
            const historyBlock = history ? `\n\n[CONVERSATION SO FAR]\n${history}\n[END HISTORY]\n` : '';
            text = `[INSTRUCTIONS]\n${systemMsg.content}\n[END]${historyBlock}\n\nUser: ${text}`;
            this._sentSystem = true;
        } else if (history) {
            text = `[CONVERSATION SO FAR]\n${history}\n[END HISTORY]\n\nUser: ${text}`;
        }

        const result = await this._send({
            text,
            conv_id: this._convId,
            resp_id: this._respId,
            choice_id: this._choiceId
        });

        this._convId = result.conv_id;
        this._respId = result.resp_id;
        this._choiceId = result.choice_id;
        this._saveSession();

        this.messages.push({ role: 'assistant', content: result.text });
        yield result.text;
    }

    reset() {
        this.messages = [];
        this._convId = '';
        this._respId = '';
        this._choiceId = '';
        this._sentSystem = false;
        try { fs.unlinkSync(SESSION_FILE); } catch {}
    }

    cleanup() {
        this._proc?.stdin?.end();
        this._proc?.kill();
    }
}

module.exports = { GeminiCookiesAdapter };
