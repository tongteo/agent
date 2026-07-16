/**
 * @fileoverview CodeGraphContext (CGC) MCP client wrapper.
 *
 * Manages a lazy-init connection to the CGC MCP server (Python backend).
 * The child process is spawned on first use and kept alive across calls.
 */

const { spawn } = require('child_process');

/** @typedef {import('@modelcontextprotocol/sdk/dist/cjs/client').Client} MCPClient */

class CGCClient {
    /**
     * @param {{ cgcCommand?: string, cgcArgs?: string[], connectTimeout?: number }} [opts]
     */
    constructor(opts = {}) {
        /** @type {string} */
        this.cgcCommand = opts.cgcCommand || '/tmp/cgc-venv/bin/codegraphcontext';
        /** @type {string[]} */
        this.cgcArgs = opts.cgcArgs || ['mcp', 'start'];
        /** @type {number} */
        this.connectTimeout = opts.connectTimeout || 15000;

        /** @type {import('child_process').ChildProcess|null} */
        this._process = null;
        /** @type {MCPClient|null} */
        this._client = null;
        /** @type {boolean} */
        this._connected = false;
        /** @type {boolean} */
        this._destroyed = false;
        /** @type {number} */
        this._nextId = 1;
        /** @type {Map<number, { resolve: Function, reject: Function }>} */
        this._pending = new Map();
        /** @type {string} */
        this._buffer = '';
        /** @type {boolean} */
        this._initialized = false;
    }

    /**
     * Ensure the CGC child process is running and the MCP handshake is done.
     * @returns {Promise<void>}
     */
    async ensureConnected() {
        if (this._connected) return;
        if (this._destroyed) throw new Error('CGCClient was destroyed');

        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                this._cleanup();
                reject(new Error(`CGC connection timed out after ${this.connectTimeout}ms`));
            }, this.connectTimeout);

            try {
                this._process = spawn(this.cgcCommand, this.cgcArgs, {
                    stdio: ['pipe', 'pipe', 'pipe'],
                    env: { ...process.env }
                });

                this._process.stdout.on('data', (data) => this._onData(data));
                this._process.stderr.on('data', () => { /* ignore */ });
                this._process.on('error', (err) => {
                    clearTimeout(timeout);
                    this._cleanup();
                    reject(new Error(`CGC process error: ${err.message}`));
                });
                this._process.on('exit', (code, signal) => {
                    this._connected = false;
                    this._initialized = false;
                    this._process = null;
                    // Reject all pending
                    for (const { reject: r } of this._pending.values()) {
                        r(new Error(`CGC process exited (code=${code}, signal=${signal})`));
                    }
                    this._pending.clear();
                });
            } catch (err) {
                clearTimeout(timeout);
                this._cleanup();
                reject(new Error(`Failed to spawn CGC: ${err.message}`));
                return;
            }

            // Wait for initialize response
            const origOnData = this._onData.bind(this);
            this._onData = (data) => {
                this._buffer += data.toString();
                // Check for initialize result
                try {
                    const msgs = this._buffer.split('\n').filter(l => l.trim());
                    for (const msg of msgs) {
                        const parsed = JSON.parse(msg);
                        if (parsed.id === 0 && parsed.result) {
                            // Initialize success
                            this._initialized = true;
                            this._connected = true;
                            clearTimeout(timeout);
                            // Send tools/list to warm up
                            this._send({ method: 'tools/list', params: {} }).catch(() => {});
                            origOnData(data);
                            resolve();
                            return;
                        }
                    }
                } catch { /* partial JSON, keep buffering */ }
                origOnData(data);
            };

            // Send initialize request
            this._sendRaw({
                jsonrpc: '2.0',
                id: 0,
                method: 'initialize',
                params: {
                    protocolVersion: '2025-03-26',
                    capabilities: { tools: {} },
                    clientInfo: { name: 'agent-cli-cgc', version: '1.0.0' }
                }
            });
        });
    }

    /**
     * Call a CGC tool and return its result.
     * @param {string} toolName - MCP tool name
     * @param {Object} args - Tool arguments
     * @returns {Promise<Object>} Tool result
     */
    async callTool(toolName, args = {}) {
        await this.ensureConnected();
        return this._send({
            method: 'tools/call',
            params: { name: toolName, arguments: args }
        });
    }

    /**
     * List available CGC MCP tools.
     * @returns {Promise<Array>}
     */
    async listTools() {
        await this.ensureConnected();
        const result = await this._send({ method: 'tools/list', params: {} });
        return result.tools || [];
    }

    /**
     * Cleanly shut down the CGC process.
     */
    destroy() {
        this._destroyed = true;
        this._cleanup();
    }

    // ---- Internal ----

    /** @private */
    _onData(data) {
        this._buffer += data.toString();
        const lines = this._buffer.split('\n');
        this._buffer = lines.pop() || ''; // keep incomplete line

        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            try {
                const msg = JSON.parse(trimmed);
                if (msg.id != null && this._pending.has(msg.id)) {
                    const { resolve, reject } = this._pending.get(msg.id);
                    this._pending.delete(msg.id);
                    if (msg.error) {
                        reject(new Error(msg.error.message || 'CGC error'));
                    } else {
                        resolve(msg.result || {});
                    }
                }
            } catch { /* skip */ }
        }
    }

    /** @private */
    _sendRaw(msg) {
        if (this._process && this._process.stdin.writable) {
            this._process.stdin.write(JSON.stringify(msg) + '\n');
        }
    }

    /** @private */
    _send(params) {
        return new Promise((resolve, reject) => {
            const id = this._nextId++;
            this._pending.set(id, { resolve, reject });
            this._sendRaw({ jsonrpc: '2.0', id, ...params });
            // Timeout per-request (120s for heavy queries)
            setTimeout(() => {
                if (this._pending.has(id)) {
                    this._pending.delete(id);
                    reject(new Error(`CGC request timed out: ${params.method}`));
                }
            }, 120000);
        });
    }

    /** @private */
    _cleanup() {
        this._connected = false;
        this._initialized = false;
        if (this._process) {
            try { this._process.kill(); } catch { /* ignore */ }
            this._process = null;
        }
        for (const { reject } of this._pending.values()) {
            reject(new Error('CGCClient destroyed'));
        }
        this._pending.clear();
    }
}

module.exports = { CGCClient };
