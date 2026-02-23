const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

class ToolRegistry {
    constructor() {
        this.tools = new Map();
        this.registerDefaultTools();
    }

    register(name, fn, description) {
        this.tools.set(name, { fn, description });
    }

    async execute(name, params) {
        const tool = this.tools.get(name);
        if (!tool) throw new Error(`Tool not found: ${name}`);
        return await tool.fn(params);
    }

    getToolList() {
        return Array.from(this.tools.entries()).map(([name, { description }]) => 
            `- ${name}: ${description}`
        ).join('\n');
    }

    registerDefaultTools() {
        this.register('read_file', async ({ path: filePath }) => {
            try {
                return fs.readFileSync(filePath, 'utf-8');
            } catch (e) {
                return `Error: ${e.message}`;
            }
        }, 'Read file content. Params: {"path": "file.txt"}');

        this.register('write_file', async ({ path: filePath, content }) => {
            try {
                fs.writeFileSync(filePath, content);
                return 'File written successfully';
            } catch (e) {
                return `Error: ${e.message}`;
            }
        }, 'Write to file. Params: {"path": "file.txt", "content": "..."}');

        this.register('list_dir', async ({ path: dirPath = '.' }) => {
            try {
                const files = fs.readdirSync(dirPath);
                return files.join('\n');
            } catch (e) {
                return `Error: ${e.message}`;
            }
        }, 'List directory. Params: {"path": "."}');

        this.register('grep', async ({ pattern, path: searchPath = '.' }) => {
            try {
                const result = execSync(`grep -r "${pattern}" ${searchPath} 2>/dev/null | head -50 || true`, {
                    encoding: 'utf-8',
                    maxBuffer: 1 * 1024 * 1024,
                    timeout: 5000
                });
                return result || 'No matches found';
            } catch (e) {
                return `Error: ${e.message}`;
            }
        }, 'Search in files. Params: {"pattern": "TODO", "path": "."}');

        this.register('find_files', async ({ pattern, path: searchPath = '.' }) => {
            try {
                const result = execSync(`find ${searchPath} -name "${pattern}" 2>/dev/null || true`, {
                    encoding: 'utf-8'
                });
                return result || 'No files found';
            } catch (e) {
                return `Error: ${e.message}`;
            }
        }, 'Find files by name. Params: {"pattern": "*.js", "path": "."}');
    }
}

module.exports = { ToolRegistry };
