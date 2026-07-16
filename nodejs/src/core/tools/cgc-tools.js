/**
 * @fileoverview CodeGraphContext (CGC) MCP tool registrations.
 *
 * Wraps the CGC Python MCP server as ToolRegistry tools.
 * Lazy-connects: the CGC process is spawned on the first tool call.
 */

const { CGCClient } = require('./cgc-client');

/** @type {CGCClient|null} */
let _cgc = null;

/**
 * Get or create the singleton CGC client.
 * @returns {CGCClient}
 */
function getCGC() {
    if (!_cgc) {
        _cgc = new CGCClient();
    }
    return _cgc;
}

/**
 * Extract text content from an MCP tool result.
 * CGC returns { content: [{ type: 'text', text: '...' }] }
 * @param {Object} result
 * @returns {string}
 */
function formatResult(result) {
    if (!result || !result.content) return JSON.stringify(result, null, 2);
    const texts = result.content
        .filter(c => c.type === 'text')
        .map(c => c.text);
    if (texts.length === 0) return JSON.stringify(result, null, 2);
    return texts.join('\n');
}

/**
 * Register CodeGraphContext tools on the given ToolRegistry.
 * @param {import('./index').ToolRegistry} registry - Tool registry instance
 */
function registerCGCTools(registry) {
    // --- CGC: Index a directory ---
    registry.register('cgc_index',
        async ({ repo_path }) => {
            try {
                const cgc = getCGC();
                const result = await cgc.callTool('add_code_to_graph', { repo_path });
                return formatResult(result);
            } catch (e) {
                return `Error: ${e.message}`;
            }
        },
        'Index a local directory into the CodeGraphContext knowledge graph. Params: {"repo_path": "/path/to/project"}',
        'code',
    );

    // --- CGC: Search code ---
    registry.register('cgc_search',
        async ({ query, repo_path }) => {
            try {
                const cgc = getCGC();
                const params = { query };
                if (repo_path) params.repo_path = repo_path;
                const result = await cgc.callTool('find_code', params);
                return formatResult(result);
            } catch (e) {
                return `Error: ${e.message}`;
            }
        },
        'Search code in the indexed graph by keyword (function name, class, content). Params: {"query": "processData", "repo_path": "/path"}',
        'code',
    );

    // --- CGC: Analyze relationships ---
    registry.register('cgc_analyze',
        async ({ query_type, target, repo_path }) => {
            try {
                const cgc = getCGC();
                const params = { query_type, target };
                if (repo_path) params.repo_path = repo_path;
                const result = await cgc.callTool('analyze_code_relationships', params);
                return formatResult(result);
            } catch (e) {
                return `Error: ${e.message}`;
            }
        },
        'Analyze code relationships: find_callers, find_callees, find_all_callers, find_all_callees, class_hierarchy, overrides, dead_code, call_chain, module_deps, variable_scope, find_complexity, find_functions_by_argument, find_functions_by_decorator. Params: {"query_type": "find_callers", "target": "myFunction"}',
        'code',
    );

    // --- CGC: List indexed repos ---
    registry.register('cgc_list',
        async () => {
            try {
                const cgc = getCGC();
                const result = await cgc.callTool('list_indexed_repositories', {});
                return formatResult(result);
            } catch (e) {
                return `Error: ${e.message}`;
            }
        },
        'List all repositories indexed in CodeGraphContext.',
        'code',
    );

    // --- CGC: Delete a repo from the graph ---
    registry.register('cgc_delete',
        async ({ repo_path }) => {
            try {
                const cgc = getCGC();
                const result = await cgc.callTool('delete_repository', { repo_path });
                return formatResult(result);
            } catch (e) {
                return `Error: ${e.message}`;
            }
        },
        'Delete a repository from the CodeGraphContext graph. Params: {"repo_path": "/path/to/project"}',
        'code',
    );

    // --- CGC: Find dead code ---
    registry.register('cgc_dead_code',
        async ({ repo_path }) => {
            try {
                const cgc = getCGC();
                const params = {};
                if (repo_path) params.repo_path = repo_path;
                const result = await cgc.callTool('find_dead_code', params);
                return formatResult(result);
            } catch (e) {
                return `Error: ${e.message}`;
            }
        },
        'Find potentially unused functions and classes in the indexed graph. Params: {"repo_path": "/path"}',
        'code',
    );

    // --- CGC: Complexity analysis ---
    registry.register('cgc_complexity',
        async ({ function_name, repo_path }) => {
            try {
                const cgc = getCGC();
                const params = { function_name };
                if (repo_path) params.repo_path = repo_path;
                const result = await cgc.callTool('calculate_cyclomatic_complexity', params);
                return formatResult(result);
            } catch (e) {
                return `Error: ${e.message}`;
            }
        },
        'Calculate cyclomatic complexity of a function. Params: {"function_name": "myFunc", "repo_path": "/path"}',
        'code',
    );

    // --- CGC: Most complex functions ---
    registry.register('cgc_complex_top',
        async ({ limit, repo_path }) => {
            try {
                const cgc = getCGC();
                const params = { limit: limit || 10 };
                if (repo_path) params.repo_path = repo_path;
                const result = await cgc.callTool('find_most_complex_functions', params);
                return formatResult(result);
            } catch (e) {
                return `Error: ${e.message}`;
            }
        },
        'Find the most cyclomatically complex functions. Params: {"limit": 10, "repo_path": "/path"}',
        'code',
    );

    // --- CGC: Execute Cypher query ---
    registry.register('cgc_cypher',
        async ({ cypher_query }) => {
            try {
                const cgc = getCGC();
                const result = await cgc.callTool('execute_cypher_query', { cypher_query });
                return formatResult(result);
            } catch (e) {
                return `Error: ${e.message}`;
            }
        },
        'Run a read-only Cypher query against the code graph for advanced analysis. Params: {"cypher_query": "MATCH (f:Function) RETURN f.name LIMIT 10"}',
        'code',
    );

    // --- CGC: Get repo stats ---
    registry.register('cgc_stats',
        async ({ repo_path }) => {
            try {
                const cgc = getCGC();
                const result = await cgc.callTool('get_repository_stats', { repo_path });
                return formatResult(result);
            } catch (e) {
                return `Error: ${e.message}`;
            }
        },
        'Get statistics about an indexed repository. Params: {"repo_path": "/path/to/project"}',
        'code',
    );

    // --- CGC: Watch directory ---
    registry.register('cgc_watch',
        async ({ repo_path }) => {
            try {
                const cgc = getCGC();
                const result = await cgc.callTool('watch_directory', { repo_path });
                return formatResult(result);
            } catch (e) {
                return `Error: ${e.message}`;
            }
        },
        'Watch a directory for changes and automatically update the code graph. Params: {"repo_path": "/path/to/project"}',
        'code',
    );

    // --- CGC: Stop watching ---
    registry.register('cgc_unwatch',
        async ({ repo_path }) => {
            try {
                const cgc = getCGC();
                const result = await cgc.callTool('unwatch_directory', { repo_path });
                return formatResult(result);
            } catch (e) {
                return `Error: ${e.message}`;
            }
        },
        'Stop watching a directory for changes. Params: {"repo_path": "/path/to/project"}',
        'code',
    );

    // --- CGC: Check job status ---
    registry.register('cgc_job_status',
        async ({ job_id }) => {
            try {
                const cgc = getCGC();
                const result = await cgc.callTool('check_job_status', { job_id });
                return formatResult(result);
            } catch (e) {
                return `Error: ${e.message}`;
            }
        },
        'Check the status of a background indexing job. Params: {"job_id": "..."}',
        'code',
    );

    // --- CGC: Generate report ---
    registry.register('cgc_report',
        async ({ output_path }) => {
            try {
                const cgc = getCGC();
                const params = {};
                if (output_path) params.output_path = output_path;
                const result = await cgc.callTool('generate_report', params);
                return formatResult(result);
            } catch (e) {
                return `Error: ${e.message}`;
            }
        },
        'Generate a CGC_REPORT.md with god nodes, complexity, cross-module connections. Params: {"output_path": "/path/to/project"}',
        'code',
    );

    // --- CGC: Add package ---
    registry.register('cgc_add_package',
        async ({ package_name, language }) => {
            try {
                const cgc = getCGC();
                const result = await cgc.callTool('add_package_to_graph', {
                    package_name,
                    language: language || 'javascript'
                });
                return formatResult(result);
            } catch (e) {
                return `Error: ${e.message}`;
            }
        },
        'Add a package to the code graph for dependency analysis. Params: {"package_name": "express", "language": "javascript"}',
        'code',
    );
}

module.exports = { registerCGCTools, getCGC };
