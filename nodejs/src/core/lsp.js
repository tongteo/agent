const { spawn } = require('child_process');
const { StreamMessageReader, StreamMessageWriter, createMessageConnection } = require('vscode-jsonrpc/node');
const { execSync } = require('child_process');

class LSPClient {
    constructor(command, args, rootPath) {
        this.command = command;
        this.args = args;
        this.rootPath = rootPath;
        this.connection = null;
        this.process = null;
        this.initialized = false;
    }

    static commandExists(cmd) {
        try {
            execSync(`which ${cmd}`, { stdio: 'ignore' });
            return true;
        } catch {
            return false;
        }
    }

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

        // Initialize
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

    async gotoDefinition(filePath, line, character) {
        if (!this.initialized) throw new Error('LSP not initialized');
        
        const uri = `file://${filePath}`;
        await this.connection.sendNotification('textDocument/didOpen', {
            textDocument: {
                uri,
                languageId: this.getLanguageId(filePath),
                version: 1,
                text: require('fs').readFileSync(filePath, 'utf-8')
            }
        });

        const result = await this.connection.sendRequest('textDocument/definition', {
            textDocument: { uri },
            position: { line, character }
        });

        return result;
    }

    async findReferences(filePath, line, character) {
        if (!this.initialized) throw new Error('LSP not initialized');
        
        const uri = `file://${filePath}`;
        await this.connection.sendNotification('textDocument/didOpen', {
            textDocument: {
                uri,
                languageId: this.getLanguageId(filePath),
                version: 1,
                text: require('fs').readFileSync(filePath, 'utf-8')
            }
        });

        const result = await this.connection.sendRequest('textDocument/references', {
            textDocument: { uri },
            position: { line, character },
            context: { includeDeclaration: true }
        });

        return result;
    }

    async getHover(filePath, line, character) {
        if (!this.initialized) throw new Error('LSP not initialized');
        
        const uri = `file://${filePath}`;
        const result = await this.connection.sendRequest('textDocument/hover', {
            textDocument: { uri },
            position: { line, character }
        });

        return result;
    }

    async getDocumentSymbols(filePath) {
        if (!this.initialized) throw new Error('LSP not initialized');
        
        const uri = `file://${filePath}`;
        await this.connection.sendNotification('textDocument/didOpen', {
            textDocument: {
                uri,
                languageId: this.getLanguageId(filePath),
                version: 1,
                text: require('fs').readFileSync(filePath, 'utf-8')
            }
        });

        const result = await this.connection.sendRequest('textDocument/documentSymbol', {
            textDocument: { uri }
        });

        return result;
    }

    async getDiagnostics(filePath) {
        if (!this.initialized) throw new Error('LSP not initialized');
        
        const uri = `file://${filePath}`;
        await this.connection.sendNotification('textDocument/didOpen', {
            textDocument: {
                uri,
                languageId: this.getLanguageId(filePath),
                version: 1,
                text: require('fs').readFileSync(filePath, 'utf-8')
            }
        });

        // Wait for diagnostics to be published
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

    async renameSymbol(filePath, line, character, newName) {
        if (!this.initialized) throw new Error('LSP not initialized');
        
        const uri = `file://${filePath}`;
        await this.connection.sendNotification('textDocument/didOpen', {
            textDocument: {
                uri,
                languageId: this.getLanguageId(filePath),
                version: 1,
                text: require('fs').readFileSync(filePath, 'utf-8')
            }
        });

        const result = await this.connection.sendRequest('textDocument/rename', {
            textDocument: { uri },
            position: { line, character },
            newName
        });

        return result;
    }

    async getWorkspaceSymbols(query) {
        if (!this.initialized) throw new Error('LSP not initialized');
        
        const result = await this.connection.sendRequest('workspace/symbol', {
            query
        });

        return result;
    }

    getLanguageId(filePath) {
        const ext = filePath.split('.').pop();
        const map = {
            'js': 'javascript',
            'ts': 'typescript',
            'py': 'python',
            'rs': 'rust',
            'go': 'go',
            'java': 'java',
            'c': 'c',
            'cpp': 'cpp',
            'cc': 'cpp',
            'cxx': 'cpp',
            'h': 'cpp',
            'hpp': 'cpp',
            'html': 'html',
            'htm': 'html',
            'css': 'css'
        };
        return map[ext] || 'plaintext';
    }

    async stop() {
        if (this.connection) {
            await this.connection.sendRequest('shutdown', null);
            await this.connection.sendNotification('exit', null);
        }
        if (this.process) {
            this.process.kill();
        }
    }
}

module.exports = { LSPClient };
