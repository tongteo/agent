/**
 * @fileoverview LSP (Language Server Protocol) tools for the agent.
 * Provides code intelligence: go-to-definition, references, symbols, diagnostics, rename.
 */

const path = require('path');
const { LANG_MAP } = require('./utils');
const { LSPClient } = require('../lsp');

/**
 * Get the language identifier from a file path.
 * @param {string} filePath - Path to the file
 * @returns {string|null} Language identifier or null if unsupported
 */
function getLanguage(filePath) {
    const ext = filePath.split('.').pop();
    return LANG_MAP[ext] || null;
}

/**
 * Ensure an LSP client is initialized for the given language.
 * @param {import('./index').ToolRegistry} registry - Tool registry
 * @param {string} lang - Language identifier
 * @returns {Promise<import('../lsp').LSPClient|null>} LSP client or null
 */
async function ensureClient(registry, lang) {
    if (!lang) return null;
    let client = registry.lspClients.get(lang);
    if (!client) {
        client = await registry.initLSP(lang, registry.session?.workingDir || process.cwd());
    }
    return client;
}

/**
 * Register LSP tools on the given ToolRegistry.
 * @param {import('./index').ToolRegistry} registry - Tool registry instance
 */
function registerLSPTools(registry) {
    // --- Go to definition ---
    registry.register('goto_definition',
        async ({ file, line, character }) => {
            try {
                const lang = getLanguage(file);
                if (!lang) return 'Language not supported';

                const client = await ensureClient(registry, lang);
                if (!client) return 'LSP not available';

                const result = await client.gotoDefinition(path.resolve(file), line, character);
                return JSON.stringify(result, null, 2);
            } catch (e) {
                return `Error: ${e.message}`;
            }
        },
        'Go to definition. Params: {"file": "file.js", "line": 10, "character": 5}'
    );

    // --- Find references ---
    registry.register('find_references',
        async ({ file, line, character }) => {
            try {
                const lang = getLanguage(file);
                if (!lang) return 'Language not supported';

                const client = await ensureClient(registry, lang);
                if (!client) return 'LSP not available';

                const result = await client.findReferences(path.resolve(file), line, character);
                return JSON.stringify(result, null, 2);
            } catch (e) {
                return `Error: ${e.message}`;
            }
        },
        'Find references. Params: {"file": "file.js", "line": 10, "character": 5}'
    );

    // --- Get document symbols ---
    registry.register('get_symbols',
        async ({ file }) => {
            try {
                const lang = getLanguage(file);
                if (!lang) return 'Language not supported';

                const client = await ensureClient(registry, lang);
                if (!client) return 'LSP not available';

                const result = await client.getDocumentSymbols(path.resolve(file));
                return JSON.stringify(result, null, 2);
            } catch (e) {
                return `Error: ${e.message}`;
            }
        },
        'Get document symbols. Params: {"file": "file.js"}'
    );

    // --- Get diagnostics ---
    registry.register('get_diagnostics',
        async ({ file }) => {
            try {
                const lang = getLanguage(file);
                if (!lang) return 'Language not supported';

                const client = await ensureClient(registry, lang);
                if (!client) return 'LSP not available';

                const result = await client.getDiagnostics(path.resolve(file));
                return JSON.stringify(result, null, 2);
            } catch (e) {
                return `Error: ${e.message}`;
            }
        },
        'Get diagnostics (errors/warnings). Params: {"file": "file.js"}'
    );

    // --- Rename symbol ---
    registry.register('rename_symbol',
        async ({ file, line, character, new_name }) => {
            try {
                const lang = getLanguage(file);
                if (!lang) return 'Language not supported';

                const client = await ensureClient(registry, lang);
                if (!client) return 'LSP not available';

                const result = await client.renameSymbol(path.resolve(file), line, character, new_name);
                return JSON.stringify(result, null, 2);
            } catch (e) {
                return `Error: ${e.message}`;
            }
        },
        'Rename symbol. Params: {"file": "file.js", "line": 10, "character": 5, "new_name": "newName"}'
    );

    // --- Workspace symbols ---
    registry.register('workspace_symbols',
        async ({ query }) => {
            try {
                // Use first available LSP client
                const client = Array.from(registry.lspClients.values())[0];
                if (!client) {
                    const tsClient = await ensureClient(registry, 'javascript');
                    if (!tsClient) return 'LSP not available';
                    const result = await tsClient.getWorkspaceSymbols(query);
                    return JSON.stringify(result, null, 2);
                }

                const result = await client.getWorkspaceSymbols(query);
                return JSON.stringify(result, null, 2);
            } catch (e) {
                return `Error: ${e.message}`;
            }
        },
        'Search symbols in workspace. Params: {"query": "MyClass"}'
    );
}

module.exports = { registerLSPTools, getLanguage, ensureClient };
