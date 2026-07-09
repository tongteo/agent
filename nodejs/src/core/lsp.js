/**
 * @fileoverview LSP (Language Server Protocol) client for code intelligence.
 * Supports go-to-definition, find references, hover, document symbols, diagnostics, rename.
 */

const { spawn } = require('child_process');
const { StreamMessageReader, StreamMessageWriter, createMessageConnection } = require('vscode-jsonrpc/node');
const { execSync } = require('child_process');

class LSPClient {
    /**
     * @param {string} command - LSP server executable
     * @param {string[]} args - CLI arguments
     * @param {string} rootPath - Project root directory
     */
    constructor(command, args, rootPath) {
        /** @type {string} */
        this.command = command;
        /** @type {string[]} */
        this.args = args;
        /** @type {string} */
        this.rootPath = rootPath;
        /** @type {Object|null} */
        this.connection = null;
        /** @type {import('child_process').ChildProcess|null} */
        this.process = null;
        /** @type {boolean} */
        this.initialized = false;
    }

    /**
     * Check if a command exists on PATH.
     * @param {string} cmd - Command name
     * @returns {boolean} Whether the command is available
     */
    static commandExists(cmd) {
        try {
            execSync(`which ${cmd}`, { stdio: 'ignore' });
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Start the LSP server and initialize the connection.
     * @returns {Promise<Object>} Initialize result from server
     * @throws {Error} If command not found or connection fails
     */
    async start() {
        if (!LSPClient.commandExists(this.command)) {
            throw new Error(`${this.command} not found`);
        }

        this.process = spawn(this.command, this.args, {
            cwd: this.rootPath,
            stdio: 'pipe'
        });

        const reader = new StreamMessageReader(this.process.stdout);
        const writer = new StreamMessageWriter(this.process.stdin);
        this.connection = createMessageConnection(reader, writer);

        this.connection.listen();

        const initResult = await this.connection.sendRequest('initialize', {
            processId: process.pid,
            rootUri: `file://${this.rootPath}`,
            capabilities: {
                textDocument: {
                    hover: { contentFormat: ['plaintext'] },
                    definition: { linkSupport: false },
                    references: {},
                    documentSymbol: {}
                }
            }
        });

        await this.connection.sendNotification('initialized', {});
        this.initialized = true;
        return initResult;
    }

    /**
     * Open a document in the LSP server.
     * @param {string} filePath - Absolute path to file
     * @private
     */
    async _openDocument(filePath) {
        const uri = `file://${filePath}`;
        await this.connection.sendNotification('textDocument/didOpen', {
            textDocument: {
                uri,
                languageId: this.getLanguageId(filePath),
                version: 1,
                text: require('fs').readFileSync(filePath, 'utf-8')
            }
        });
    }

    /**
     * Go to definition for a symbol at position.
     * @param {string} filePath - File path
     * @param {number} line - Line (0-indexed)
     * @param {number} character - Character offset
     * @returns {Promise<Object>} Definition result
     */
    async gotoDefinition(filePath, line, character) {
        if (!this.initialized) throw new Error('LSP not initialized');
        const uri = `file://${filePath}`;
        await this._openDocument(filePath);

        return await this.connection.sendRequest('textDocument/definition', {
            textDocument: { uri },
            position: { line, character }
        });
    }

    /**
     * Find references for a symbol at position.
     * @param {string} filePath - File path
     * @param {number} line - Line (0-indexed)
     * @param {number} character - Character offset
     * @returns {Promise<Object>} References result
     */
    async findReferences(filePath, line, character) {
        if (!this.initialized) throw new Error('LSP not initialized');
        const uri = `file://${filePath}`;
        await this._openDocument(filePath);

        return await this.connection.sendRequest('textDocument/references', {
            textDocument: { uri },
            position: { line, character },
            context: { includeDeclaration: true }
        });
    }

    /**
     * Get hover info for a symbol.
     * @param {string} filePath - File path
     * @param {number} line - Line
     * @param {number} character - Character offset
     * @returns {Promise<Object>} Hover result
     */
    async getHover(filePath, line, character) {
        if (!this.initialized) throw new Error('LSP not initialized');
        const uri = `file://${filePath}`;

        return await this.connection.sendRequest('textDocument/hover', {
            textDocument: { uri },
            position: { line, character }
        });
    }

    /**
     * Get document symbols (functions, classes, etc.).
     * @param {string} filePath - File path
     * @returns {Promise<Object>} Document symbols
     */
    async getDocumentSymbols(filePath) {
        if (!this.initialized) throw new Error('LSP not initialized');
        const uri = `file://${filePath}`;
        await this._openDocument(filePath);

        return await this.connection.sendRequest('textDocument/documentSymbol', {
            textDocument: { uri }
        });
    }

    /**
     * Get diagnostics (errors/warnings) for a file.
     * @param {string} filePath - File path
     * @returns {Promise<Array>} Diagnostics array
     */
    async getDiagnostics(filePath) {
        if (!this.initialized) throw new Error('LSP not initialized');
        const uri = `file://${filePath}`;
        await this._openDocument(filePath);

        return new Promise((resolve) => {
            const timeout = setTimeout(() => resolve([]), 1000);
            this.connection.onNotification('textDocument/publishDiagnostics', (params) => {
                if (params.uri === uri) {
                    clearTimeout(timeout);
                    resolve(params.diagnostics);
                }
            });
        });
    }

    /**
     * Rename a symbol across the workspace.
     * @param {string} filePath - File path
     * @param {number} line - Line
     * @param {number} character - Character offset
     * @param {string} newName - New symbol name
     * @returns {Promise<Object>} Rename result with changes
     */
    async renameSymbol(filePath, line, character, newName) {
        if (!this.initialized) throw new Error('LSP not initialized');
        const uri = `file://${filePath}`;
        await this._openDocument(filePath);

        return await this.connection.sendRequest('textDocument/rename', {
            textDocument: { uri },
            position: { line, character },
            newName
        });
    }

    /**
     * Search for symbols in the workspace by query.
     * @param {string} query - Symbol query string
     * @returns {Promise<Object>} Workspace symbols
     */
    async getWorkspaceSymbols(query) {
        if (!this.initialized) throw new Error('LSP not initialized');

        return await this.connection.sendRequest('workspace/symbol', { query });
    }

    /**
     * Map file extension to LSP language identifier.
     * @param {string} filePath - File path
     * @returns {string} Language identifier
     */
    getLanguageId(filePath) {
        const ext = filePath.split('.').pop();
        const map = {
            js: 'javascript', ts: 'typescript',
            py: 'python', rs: 'rust', go: 'go', java: 'java',
            c: 'c', cpp: 'cpp', cc: 'cpp', cxx: 'cpp',
            h: 'cpp', hpp: 'cpp',
            html: 'html', htm: 'html', css: 'css'
        };
        return map[ext] || 'plaintext';
    }

    /**
     * Stop the LSP server gracefully.
     */
    async stop() {
        if (this.connection) {
            try {
                await this.connection.sendRequest('shutdown', null);
                await this.connection.sendNotification('exit', null);
            } catch { /* ignore shutdown errors */ }
        }
        if (this.process) {
            this.process.kill();
        }
    }
}

module.exports = { LSPClient };
