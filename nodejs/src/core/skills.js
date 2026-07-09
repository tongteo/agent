/**
 * @fileoverview SkillManager — load, parse, create, edit, and inject reusable procedural
 * knowledge into the agent's system prompt, mirroring Hermes Agent's skills system.
 *
 * Skills are .md files stored in <project>/skills/ with optional YAML frontmatter:
 *
 *   ---
 *   name: my-skill
 *   description: "What this skill teaches the agent"
 *   tags: [linux, bash]
 *   ---
 *
 * The frontmatter is parsed and stripped; only the body is injected into the prompt.
 */

const fs = require('fs');
const path = require('path');

class SkillManager {
    /**
     * @param {string} [skillsDir] - Path to skills directory (default: cwd/skills)
     */
    constructor(skillsDir = null) {
        /** @type {string} */
        this.skillsDir = skillsDir || path.join(process.cwd(), 'skills');
        /** @type {Map<string, {name: string, description: string, tags: string[], body: string, filePath: string}>} */
        this._allSkills = new Map();
        /** @type {Map<string, {name: string, body: string}>} */
        this._loadedSkills = new Map();
        this._ensureDir();
        this._scan();
    }

    /** @private */
    _ensureDir() {
        try {
            if (!fs.existsSync(this.skillsDir)) {
                fs.mkdirSync(this.skillsDir, { recursive: true });
            }
        } catch (e) { /* readonly fs */ }
    }

    /** @private */
    _scan() {
        this._allSkills.clear();
        try {
            if (!fs.existsSync(this.skillsDir)) return;
            const files = fs.readdirSync(this.skillsDir);
            for (const file of files) {
                if (!file.endsWith('.md')) continue;
                const filePath = path.join(this.skillsDir, file);
                const parsed = this._parseFile(filePath);
                if (parsed) {
                    this._allSkills.set(parsed.name, parsed);
                }
            }
        } catch (e) { /* silent */ }
    }

    /**
     * Parse a skill file with optional YAML frontmatter.
     * @param {string} filePath
     * @returns {{name: string, description: string, tags: string[], body: string, filePath: string}|null}
     * @private
     */
    _parseFile(filePath) {
        try {
            const raw = fs.readFileSync(filePath, 'utf-8');
            const baseName = path.basename(filePath, '.md');
            let name = baseName;
            let description = '';
            let tags = [];
            let body = raw;

            const fm = raw.match(/^---\s*\n([\s\S]*?)\n---\s*\n/);
            if (fm) {
                const yamlBlock = fm[1];
                body = raw.slice(fm[0].length);
                const nMatch = yamlBlock.match(/^name:\s*(.+)$/m);
                if (nMatch) name = nMatch[1].trim();
                const dMatch = yamlBlock.match(/^description:\s*['"]?(.+?)['"]?$/m);
                if (dMatch) description = dMatch[1].trim();
                const tMatch = yamlBlock.match(/^tags:\s*\[(.+?)\]/m);
                if (tMatch) {
                    tags = tMatch[1].split(',').map(t => t.trim().replace(/['"]/g, ''));
                }
            }
            return { name, description, tags, body: body.trim(), filePath };
        } catch (e) {
            return null;
        }
    }

    /**
     * Build frontmatter YAML string from components.
     * @param {string} name
     * @param {string} [description]
     * @param {string[]} [tags]
     * @returns {string}
     */
    _buildFrontmatter(name, description = '', tags = []) {
        const lines = ['---', `name: ${name}`];
        if (description) lines.push(`description: "${description.replace(/"/g, '\\"')}"`);
        if (tags.length) lines.push(`tags: [${tags.join(', ')}]`);
        lines.push('---\n');
        return lines.join('\n');
    }

    /**
     * List all available skills.
     * @returns {Array<{name: string, description: string, tags: string[], loaded: boolean}>}
     */
    list() {
        const result = [];
        for (const [name, skill] of this._allSkills) {
            result.push({
                name,
                description: skill.description,
                tags: skill.tags,
                loaded: this._loadedSkills.has(name)
            });
        }
        return result;
    }

    /**
     * Find a skill by name (exact or case-insensitive).
     * @param {string} name
     * @returns {{name: string, description: string, tags: string[], body: string, filePath: string}|null}
     */
    view(name) {
        const skill = this._allSkills.get(name);
        if (skill) return { ...skill };
        for (const [, s] of this._allSkills) {
            if (s.name.toLowerCase() === name.toLowerCase()) return { ...s };
        }
        return null;
    }

    /**
     * Load a skill into the active session.
     * @param {string} name
     * @returns {{success: boolean, error?: string}}
     */
    load(name) {
        const skill = this.view(name);
        if (!skill) {
            return { success: false, error: `Skill not found: "${name}".` };
        }
        if (this._loadedSkills.has(skill.name)) {
            return { success: false, error: `Skill "${skill.name}" is already loaded` };
        }
        this._loadedSkills.set(skill.name, { name: skill.name, body: skill.body });
        return { success: true };
    }

    /**
     * Create a new skill file on disk and register it.
     * @param {string} name
     * @param {string} body - Full markdown body (may include frontmatter; if not, it's generated)
     * @param {string} [description]
     * @param {string[]} [tags]
     * @returns {{success: boolean, error?: string}}
     */
    create(name, body, description = '', tags = []) {
        if (!name || !name.trim()) {
            return { success: false, error: 'Skill name is required' };
        }
        const safeName = name.trim().replace(/[^a-z0-9_-]/gi, '-').toLowerCase();
        const filePath = path.join(this.skillsDir, `${safeName}.md`);

        if (fs.existsSync(filePath)) {
            return { success: false, error: `Skill "${safeName}" already exists. Use skill_manage with patch/edit to modify it.` };
        }

        // If body already has frontmatter, write as-is; otherwise wrap it
        let content = body;
        if (!body.startsWith('---\n')) {
            const fm = this._buildFrontmatter(name, description, tags);
            content = fm + body.trim();
        }

        try {
            fs.writeFileSync(filePath, content, 'utf-8');
            this._scan(); // re-scan to pick up the new skill
            return { success: true };
        } catch (e) {
            return { success: false, error: `Failed to write skill: ${e.message}` };
        }
    }

    /**
     * Edit a skill's full content (replace entire file).
     * @param {string} name
     * @param {string} newContent - Full new content (with or without frontmatter)
     * @returns {{success: boolean, error?: string}}
     */
    edit(name, newContent) {
        const skill = this.view(name);
        if (!skill) {
            return { success: false, error: `Skill not found: "${name}"` };
        }
        try {
            fs.writeFileSync(skill.filePath, newContent, 'utf-8');
            this._scan();
            // If the skill was loaded, update the loaded body too
            if (this._loadedSkills.has(skill.name)) {
                const parsed = this._parseFile(skill.filePath);
                if (parsed) {
                    this._loadedSkills.set(skill.name, { name: parsed.name, body: parsed.body });
                }
            }
            return { success: true };
        } catch (e) {
            return { success: false, error: `Failed to edit skill: ${e.message}` };
        }
    }

    /**
     * Patch a skill (find-and-replace within the file body).
     * @param {string} name
     * @param {string} oldStr - Text to find
     * @param {string} newStr - Replacement text
     * @returns {{success: boolean, error?: string}}
     */
    patch(name, oldStr, newStr) {
        const skill = this.view(name);
        if (!skill) {
            return { success: false, error: `Skill not found: "${name}"` };
        }
        try {
            let content = fs.readFileSync(skill.filePath, 'utf-8');
            if (!content.includes(oldStr)) {
                return { success: false, error: 'old_str not found in skill content' };
            }
            content = content.replace(oldStr, newStr);
            fs.writeFileSync(skill.filePath, content, 'utf-8');
            this._scan();
            if (this._loadedSkills.has(skill.name)) {
                const parsed = this._parseFile(skill.filePath);
                if (parsed) {
                    this._loadedSkills.set(skill.name, { name: parsed.name, body: parsed.body });
                }
            }
            return { success: true };
        } catch (e) {
            return { success: false, error: `Failed to patch skill: ${e.message}` };
        }
    }

    /**
     * Delete a skill file from disk.
     * @param {string} name
     * @returns {{success: boolean, error?: string}}
     */
    delete(name) {
        const skill = this.view(name);
        if (!skill) {
            return { success: false, error: `Skill not found: "${name}"` };
        }
        try {
            fs.unlinkSync(skill.filePath);
            this._allSkills.delete(skill.name);
            this._loadedSkills.delete(skill.name);
            return { success: true };
        } catch (e) {
            return { success: false, error: `Failed to delete skill: ${e.message}` };
        }
    }

    /**
     * Full-text search across all skill names, descriptions, tags, and bodies.
     * @param {string} query - Search keywords
     * @returns {Array<{name: string, description: string, tags: string[], snippet: string, score: number}>}
     */
    search(query) {
        if (!query || !query.trim()) return [];
        const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
        if (terms.length === 0) return [];

        const results = [];
        for (const [, skill] of this._allSkills) {
            let score = 0;
            const haystack = (skill.name + ' ' + skill.description + ' ' + skill.tags.join(' ') + ' ' + skill.body).toLowerCase();

            for (const term of terms) {
                if (skill.name.toLowerCase().includes(term)) score += 10;
                if (skill.description.toLowerCase().includes(term)) score += 5;
                if (skill.tags.some(t => t.toLowerCase().includes(term))) score += 3;
                // Count occurrences in body
                const bodyMatches = (skill.body.toLowerCase().match(new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;
                score += bodyMatches;
            }

            if (score > 0) {
                // Extract a snippet around the first match position
                let snippet = '';
                const firstMatchIdx = skill.body.toLowerCase().indexOf(terms[0]);
                if (firstMatchIdx >= 0) {
                    const start = Math.max(0, firstMatchIdx - 60);
                    const end = Math.min(skill.body.length, firstMatchIdx + 140);
                    snippet = (start > 0 ? '...' : '') +
                        skill.body.slice(start, end).replace(/\n/g, ' ') +
                        (end < skill.body.length ? '...' : '');
                } else {
                    snippet = skill.body.slice(0, 200).replace(/\n/g, ' ');
                }

                results.push({
                    name: skill.name,
                    description: skill.description,
                    tags: skill.tags,
                    snippet: snippet.trim(),
                    score
                });
            }
        }

        return results.sort((a, b) => b.score - a.score);
    }

    /** @returns {boolean} */
    isLoaded(name) {
        return this._loadedSkills.has(name);
    }

    /** @returns {string[]} */
    getLoadedSkillNames() {
        return Array.from(this._loadedSkills.keys());
    }

    /**
     * Get formatted string of all loaded skills for system prompt injection.
     * @returns {string}
     */
    getLoadedPromptAdditions() {
        if (this._loadedSkills.size === 0) return '';

        const parts = [];
        parts.push('\n\n[Loaded Skills]');
        parts.push('The following skills have been loaded into this session. Follow their instructions when relevant.\n');

        for (const { name, body } of this._loadedSkills.values()) {
            parts.push(`=== Skill: ${name} ===`);
            parts.push(body);
            parts.push('');
        }

        return parts.join('\n');
    }

    /** Re-scan the skills directory for new/modified files. */
    refresh() {
        this._scan();
    }
}

module.exports = { SkillManager };
