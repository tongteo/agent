/**
 * @fileoverview ToolRegistry — central registry for all agent tools.
 *
 * Manages tool registration, execution, LSP lifecycle, and subagent delegation.
 * Composed from focused sub-modules (file-ops, lsp-tools, misc-tools, subagent-tools).
 *
 * Tool registration supports an optional 3rd argument (group, e.g. 'files', 'lsp')
 * and an optional 4th argument (paramSchema), enabling getToolSchemas() to produce
 * accurate OpenAI-compatible JSON schemas for function-calling models.
 */

const fs = require('fs');
const path = require('path');
const { LSPClient } = require('../lsp');
const { DiffFormatter } = require('../../ui/diff');
const {
    sanitizeToolOutput,
    commandExists,
    LANG_MAP
} = require('./utils');
const { registerFileOps } = require('./file-ops');
const { registerLSPTools } = require('./lsp-tools');
const { registerMiscTools } = require('./misc-tools');
const { registerSubagentTools } = require('./subagent-tools');
const { ToolParser } = require('../agent');

class ToolRegistry {
    /**
     * @param {import('../session').SessionManager} session - Session manager instance
     */
    constructor(session) {
        /** @type {Map<string, { fn: Function, description: string, group: string, schema: Object|null }>} */
        this.tools = new Map();
        /** @type {Map<string, string[]>} */
        this.toolGroups = new Map();
        /** @type {Map<string, LSPClient>} */
        this.lspClients = new Map();
        /** @type {import('../session').SessionManager} */
        this.session = session;
        /** @type {import('./subagent-tools').SubagentManager|null} */
        this.subagentManager = null;
        this.registerDefaultTools();
    }

    /**
     * Register a tool by name.
     * @param {string} name - Tool name
     * @param {Function} fn - Async function implementing the tool
     * @param {string} description - Human-readable description with param examples
     * @param {string} [group] - Tool group/category (e.g. 'files', 'skills', 'lsp')
     * @param {Object|null} [schema] - Explicit JSON schema for function calling; auto-generated if omitted
     */
    register(name, fn, description, group = '', schema = null) {
        this.tools.set(name, { fn, description, group, schema });
        if (group) {
            if (!this.toolGroups.has(group)) this.toolGroups.set(group, []);
            this.toolGroups.get(group).push(name);
        }
    }

    /**
     * Execute a tool by name with sanitized output.
     * @param {string} name - Tool name
     * @param {Object} params - Parameters object
     * @returns {Promise<string>} Tool result (sanitized)
     * @throws {Error} If tool not found
     */
    async execute(name, params) {
        const tool = this.tools.get(name);
        if (!tool) throw new Error(`Tool not found: ${name}`);
        const result = await tool.fn(params);
        return sanitizeToolOutput(result);
    }

    /**
     * Get a human-readable list of all tools, grouped by category.
     * @returns {string} Formatted tool list
     */
    getToolList() {
        const groups = new Map();
        const standalone = [];

        for (const [name, { description, group }] of this.tools) {
            if (group) {
                if (!groups.has(group)) groups.set(group, []);
                groups.get(group).push(`  - ${name}: ${description}`);
            } else {
                standalone.push(`- ${name}: ${description}`);
            }
        }

        const parts = [...standalone];
        for (const [group, tools] of groups) {
            parts.push(`\n[${group.toUpperCase()}]`);
            parts.push(...tools);
        }
        return parts.join('\n');
    }

    /**
     * Get JSON Schema-compatible tool definitions for function-calling models.
     * Uses explicit schema when provided; falls back to description-parsing for legacy tools.
     * @returns {Object[]} Array of tool schemas
     */
    getToolSchemas() {
        const paramRegex = /Params: ({.*})/;
        return Array.from(this.tools.entries()).map(([name, { description, schema }]) => {
            // Use explicit schema when provided (rich, accurate)
            if (schema) {
                return {
                    type: 'function',
                    function: {
                        name,
                        description: schema.description || description,
                        parameters: {
                            type: 'object',
                            properties: schema.properties || {},
                            required: schema.required || []
                        }
                    }
                };
            }

            // Legacy fallback: parse Params: {...} from description
            const match = description.match(paramRegex);
            let properties = {}, required = [];
            if (match) {
                try {
                    const example = JSON.parse(match[1]);
                    for (const [k, v] of Object.entries(example)) {
                        properties[k] = { type: Array.isArray(v) ? 'array' : typeof v };
                        if (typeof v === 'string' || typeof v === 'number') required.push(k);
                    }
                } catch { /* skip */ }
            }
            return {
                type: 'function',
                function: {
                    name,
                    description: description.replace(/\. Params:.*/, '').replace(/\. Params.*/s, ''),
                    parameters: { type: 'object', properties, required }
                }
            };
        });
    }

    /**
     * Initialize an LSP client for a language.
     * @param {string} language - Language identifier (e.g. 'javascript')
     * @param {string} rootPath - Project root path
     * @returns {Promise<LSPClient|null>} LSP client or null if unavailable
     */
    async initLSP(language, rootPath) {
        const lspConfigs = {
            typescript: { cmd: 'typescript-language-server', args: ['--stdio'] },
            javascript: { cmd: 'typescript-language-server', args: ['--stdio'] },
            python: { cmd: 'pylsp', args: [] },
            rust: { cmd: 'rust-analyzer', args: [] },
            c: { cmd: 'clangd', args: [] },
            cpp: { cmd: 'clangd', args: [] },
            html: { cmd: 'vscode-html-language-server', args: ['--stdio'] },
            css: { cmd: 'vscode-css-language-server', args: ['--stdio'] }
        };

        const config = lspConfigs[language];
        if (!config) return null;

        const client = new LSPClient(config.cmd, config.args, rootPath);
        try {
            await client.start();
            this.lspClients.set(language, client);
            return client;
        } catch (e) {
            return null;
        }
    }

    /**
     * Clean up all LSP clients.
     */
    async cleanup() {
        for (const client of this.lspClients.values()) {
            await client.stop();
        }
        this.lspClients.clear();
    }

    /**
     * Register all default tools from sub-modules.
     */
    registerDefaultTools() {
        registerFileOps(this);
        registerLSPTools(this);
        registerMiscTools(this);
        registerSubagentTools(this);
        // Sync tool names to ToolParser for JSON-format detection
        ToolParser.syncToolNames(this);
    }

    /**
     * Generate a human-readable directory tree.
     * @param {string} dirPath - Root directory
     * @param {number} depth - Max depth
     * @param {string[]} ignore - Patterns to ignore
     * @param {number} currentDepth - Current recursion depth
     * @param {string} prefix - Line prefix for formatting
     * @returns {string} Tree string
     */
    manualTree(dirPath, depth, ignore, currentDepth = 0, prefix = '') {
        if (currentDepth >= depth) return '';

        try {
            const entries = fs.readdirSync(dirPath, { withFileTypes: true });
            let result = '';

            entries.forEach((entry, i) => {
                if (ignore.some(pattern => entry.name.includes(pattern))) return;

                const isLast = i === entries.length - 1;
                const connector = isLast ? '\u2514\u2500\u2500 ' : '\u251C\u2500\u2500 ';
                result += `${prefix}${connector}${entry.name}\n`;

                if (entry.isDirectory()) {
                    const newPrefix = prefix + (isLast ? '    ' : '\u2502   ');
                    result += this.manualTree(
                        path.join(dirPath, entry.name),
                        depth,
                        ignore,
                        currentDepth + 1,
                        newPrefix
                    );
                }
            });

            return result;
        } catch (e) {
            return '';
        }
    }

    /**
     * Set the subagent manager for delegation.
     * @param {import('./subagent-tools').SubagentManager} manager
     */
    setSubagentManager(manager) {
        this.subagentManager = manager;
    }
}

module.exports = { ToolRegistry };
