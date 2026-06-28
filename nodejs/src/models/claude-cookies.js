const { spawn } = require('child_process');
const path = require('path');
const readline = require('readline');

const SCRIPT = path.join(__dirname, '..', 'bridges', 'claude_bridge.py');

function getPythonCommand() {
    if (process.platform === 'win32') {
        return 'py';
    }
    return 'python3';
}

class ClaudeCookiesAdapter {
    constructor() {
        this.model = 'claude-web';
        this.messages = [];
        this.lastUsage = null;
        this._proc = null;
        this._rl = null;
        this._pending = null;
        this._sentSystem = false;
        this._convId = '';
    }

    async init() {
        await this._startBridge();
    }

    _startBridge() {
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error('Bridge init timeout')), 30000);
            this._proc = spawn(getPythonCommand(), [SCRIPT]);
            this._proc.on('error', e => { clearTimeout(timer); reject(e); });
            this._proc.stdin.on('error', () => {}); // suppress EPIPE
            this._proc.stderr.on('data', d => {
                const s = d.toString();
                if (s.includes('[bridge] starting...') || s.includes('[bridge] ready')) return;
                process.stderr.write(d);
            });

            this._rl = readline.createInterface({ input: this._proc.stdout });
            this._rl.on('line', line => {
                if (!line.trim()) return;
                let msg;
                try { msg = JSON.parse(line); } catch { return; }
                if (msg.ready) { clearTimeout(timer); resolve(); return; }
                if (this._pending) {
                    const { resolve: res, reject: rej } = this._pending;
                    this._pending = null;
                    if (msg.error) rej(new Error(msg.error));
                    else res(msg);
                }
            });
            this._proc.on('close', () => {
                clearTimeout(timer);
                if (this._pending) {
                    this._pending.reject(new Error('Bridge process exited'));
                    this._pending = null;
                }
            });
        });
    }

    _send(payload) {
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this._pending = null;
                reject(new Error('Bridge response timeout'));
            }, 360000);
            this._pending = {
                resolve: v => { clearTimeout(timer); resolve(v); },
                reject: e => { clearTimeout(timer); reject(e); }
            };
            try { this._proc.stdin.write(JSON.stringify(payload) + '\n'); } catch { reject(new Error('Bridge write failed')); }
        });
    }

    abort() {
        if (this._pending) {
            this._pending.reject(new Error('Aborted'));
            this._pending = null;
        }
    }

    async *streamMessage() {
        const userMsg = this.messages.at(-1);
        if (!userMsg) return;

        const systemMsg = this.messages.find(m => m.role === 'system');
        const isFirstTurn = !this._sentSystem;

        const history = this.messages
            .filter(m => m.role !== 'system' && m !== userMsg)
            .map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
            .join('\n');

        let text = userMsg.content;
        const isNewConv = !this._convId;

        if (systemMsg && (isNewConv || isFirstTurn)) {
            // const historyBlock = history ? `\n\n[CONVERSATION SO FAR]\n${history}\n[END HISTORY]\n` : '';
            const historyBlock = '';
            text = `${systemMsg.content}${historyBlock}\n\n${text}`;
            this._sentSystem = true;
        } else if (history && isNewConv) {
            // text = `[CONVERSATION SO FAR]\n${history}\n[END HISTORY]\n\n${text}`;
            // Skip history, just use text
        }

        const result = await this._send({ text, new_conv: isNewConv });
        this._convId = result.conv_id;
        this.messages.push({ role: 'assistant', content: result.text });
        yield result.text;
    }

    reset() {
        this.messages = [];
        this._convId = '';
        this._sentSystem = false;
    }

    cleanup() {
        this._proc?.stdin?.end();
        this._proc?.kill();
    }
}

module.exports = { ClaudeCookiesAdapter };
