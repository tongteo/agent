/**
 * @fileoverview Skills management tools — list, view, load, search, and CRUD skills.
 *
 * Mirrors Hermes Agent's skills toolset providing the model with full
 * skills lifecycle management:
 * - skills_list: browse available skills
 * - skill_view: read a skill's full content
 * - skill_load: inject a skill into the system prompt
 * - skill_search: full-text search across all skills
 * - skill_manage: create, edit, patch, and delete skills (self-improvement)
 *
 * Each tool registers with an explicit JSON schema for accurate function calling.
 */

/**
 * Register skills tools on the given ToolRegistry.
 * @param {import('./index').ToolRegistry} registry
 * @param {import('../skills').SkillManager} skillManager
 */
function registerSkillsTools(registry, skillManager) {
    // --- skills_list ---
    registry.register(
        'skills_list',
        async ({ filter } = {}) => {
            try {
                const all = skillManager.list();
                if (all.length === 0) {
                    return 'No skills found. Create one with skill_manage(action: "create").';
                }
                let filtered = all;
                if (filter && filter.trim()) {
                    const f = filter.toLowerCase();
                    filtered = all.filter(s =>
                        s.name.toLowerCase().includes(f) ||
                        s.description.toLowerCase().includes(f) ||
                        s.tags.some(t => t.toLowerCase().includes(f))
                    );
                }
                const lines = filtered.map((s, i) => {
                    const status = s.loaded ? ' [LOADED]' : '';
                    const tagStr = s.tags.length ? ` (${s.tags.join(', ')})` : '';
                    return `${i + 1}. ${s.name}${status} — ${s.description}${tagStr}`;
                });
                const header = filter
                    ? `Skills matching "${filter}" (${filtered.length}/${all.length}):`
                    : `Available skills (${filtered.length}):`;
                return [header, ...lines].join('\n');
            } catch (e) {
                return `Error: ${e.message}`;
            }
        },
        'List available skills. Optionally filter by name, description, or tags.',
        'skills',
        {
            description: 'Browse available skills. Returns names, descriptions, tags, and load status.',
            properties: {
                filter: { type: 'string', description: 'Optional search term to filter by name, description, or tags' }
            },
            required: []
        }
    );

    // --- skill_view ---
    registry.register(
        'skill_view',
        async ({ name }) => {
            try {
                if (!name || !name.trim()) return 'Error: missing required param "name"';
                const skill = skillManager.view(name.trim());
                if (!skill) {
                    return `Skill not found: "${name}". Use skills_list to browse available skills.`;
                }
                const loaded = skillManager.isLoaded(skill.name);
                const tagStr = skill.tags.length ? `Tags: ${skill.tags.join(', ')}` : '';
                const header = [
                    `= Skill: ${skill.name} ${loaded ? '[LOADED]' : ''}`,
                    skill.description ? `Description: ${skill.description}` : '',
                    tagStr,
                    ''.padStart(60, '=')
                ].filter(Boolean).join('\n');
                return `${header}\n\n${skill.body}`;
            } catch (e) {
                return `Error: ${e.message}`;
            }
        },
        'View a skill\'s full content by name.',
        'skills',
        {
            description: 'Read the complete content of a skill, including frontmatter (name, description, tags) and body markdown.',
            properties: {
                name: { type: 'string', description: 'Skill name (e.g. "hermes-agent", "code-conventions")' }
            },
            required: ['name']
        }
    );

    // --- skill_load ---
    registry.register(
        'skill_load',
        async ({ name }) => {
            try {
                if (!name || !name.trim()) return 'Error: missing required param "name"';
                const result = skillManager.load(name.trim());
                if (result.success) {
                    return `Skill "${name}" loaded into session. Its instructions will be included in the system prompt from the next turn onward.`;
                }
                if (result.error && result.error.includes('already loaded')) {
                    return `Skill "${name}" is already loaded and active in the system prompt.`;
                }
                return `Error: ${result.error}`;
            } catch (e) {
                return `Error: ${e.message}`;
            }
        },
        'Load a skill into the session. Its body is appended to the system prompt every turn.',
        'skills',
        {
            description: 'Activate a skill for the current session. The skill body gets injected into the system prompt on every subsequent turn so the model follows its instructions.',
            properties: {
                name: { type: 'string', description: 'Skill name to activate (e.g. "code-conventions")' }
            },
            required: ['name']
        }
    );

    // --- skill_search ---
    registry.register(
        'skill_search',
        async ({ query }) => {
            try {
                if (!query || !query.trim()) return 'Error: missing required param "query"';
                const results = skillManager.search(query.trim());
                if (results.length === 0) {
                    return `No skills match "${query}". Try different keywords or use skills_list to browse all.`;
                }
                const lines = results.map((r, i) => {
                    const tagStr = r.tags.length ? ` [${r.tags.join(', ')}]` : '';
                    return `${i + 1}. "${r.name}"${tagStr} (score: ${r.score})\n   ${r.snippet}`;
                });
                return [`[Skill Search] "${query}" — ${results.length} match(es):`, ...lines].join('\n\n');
            } catch (e) {
                return `Error: ${e.message}`;
            }
        },
        'Full-text search across skill names, descriptions, tags, and bodies.',
        'skills',
        {
            description: 'Search all installed skills by keyword. Returns ranked results with context snippets. Use this to find relevant skills for the current task.',
            properties: {
                query: { type: 'string', description: 'Search keywords (e.g. "testing C compilation")' }
            },
            required: ['query']
        }
    );

    // --- skill_manage ---
    registry.register(
        'skill_manage',
        async ({ action, name, content, description, tags, old_string, new_string }) => {
            try {
                if (!action) return 'Error: missing required param "action" (create|edit|patch|delete)';
                if (!name) return 'Error: missing required param "name"';

                const a = action.toLowerCase().trim();

                if (a === 'create') {
                    if (!content) return 'Error: missing required param "content" for create action';
                    const result = skillManager.create(
                        name, content, description || '',
                        (tags || '').split(',').map(t => t.trim()).filter(Boolean)
                    );
                    if (result.success) {
                        return `Skill "${name}" created successfully. Use skills_list to verify or skill_load to activate it.`;
                    }
                    return `Error: ${result.error}`;
                }

                if (a === 'edit') {
                    if (!content) return 'Error: missing required param "content" for edit action';
                    const result = skillManager.edit(name, content);
                    if (result.success) {
                        return `Skill "${name}" edited successfully.`;
                    }
                    return `Error: ${result.error}`;
                }

                if (a === 'patch') {
                    if (!old_string) return 'Error: missing required param "old_string" for patch action';
                    const result = skillManager.patch(name, old_string, new_string || '');
                    if (result.success) {
                        return `Skill "${name}" patched successfully.`;
                    }
                    return `Error: ${result.error}`;
                }

                if (a === 'delete') {
                    const result = skillManager.delete(name);
                    if (result.success) {
                        return `Skill "${name}" deleted.`;
                    }
                    return `Error: ${result.error}`;
                }

                return `Error: Unknown action "${action}". Use: create, edit, patch, or delete.`;
            } catch (e) {
                return `Error: ${e.message}`;
            }
        },
        'Create, edit, patch, or delete skills. Self-improvement for the agent.',
        'skills',
        {
            description: 'Full skill lifecycle management. Actions: create (new skill), edit (replace entire content), patch (find-and-replace), delete (remove skill file).',
            properties: {
                action: { type: 'string', description: 'Operation: "create" to add new skill, "edit" to replace content, "patch" for find-and-replace, "delete" to remove' },
                name: { type: 'string', description: 'Skill name (e.g. "c-programming")' },
                content: { type: 'string', description: 'Full markdown content for create/edit actions. May include YAML frontmatter (---\\nname: ...\\n---). For create, frontmatter is auto-generated if omitted.' },
                description: { type: 'string', description: 'Short description (create action only, optional)' },
                tags: { type: 'string', description: 'Comma-separated tags (create action only, optional, e.g. "c, algorithms, sorting")' },
                old_string: { type: 'string', description: 'Text to find (required for patch action)' },
                new_string: { type: 'string', description: 'Replacement text (required for patch action, empty string to delete)' }
            },
            required: ['action', 'name']
        }
    );
}

module.exports = { registerSkillsTools };
