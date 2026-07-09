/**
 * @fileoverview Diff formatter — computes and renders color-coded diffs for file changes.
 * Uses highlight.js with Tokyo Night theme for syntax highlighting in diff context.
 */

const chalk = require('chalk');
const hljs = require('highlight.js');

const c = new chalk.Instance({ level: 3 });

/**
 * Strip ANSI escape codes to get visible string length.
 * @param {string} str - String with possible ANSI codes
 * @returns {number} Visible length
 * @private
 */
function stripAnsi(str) {
    return str.replace(/\x1b\[[0-9;]*m/g, '');
}

/**
 * Detect programming language from file extension.
 * @param {string} filePath - File path
 * @returns {string} Language identifier
 * @private
 */
function detectLanguage(filePath) {
    const ext = filePath.split('.').pop();
    const langMap = {
        js: 'javascript', ts: 'typescript', jsx: 'javascript', tsx: 'typescript',
        py: 'python', rb: 'ruby', go: 'go', rs: 'rust', java: 'java',
        c: 'c', cpp: 'cpp', cc: 'cpp', h: 'c', hpp: 'cpp',
        sh: 'bash', bash: 'bash', zsh: 'bash',
        json: 'json', yaml: 'yaml', yml: 'yaml', xml: 'xml',
        html: 'html', css: 'css', scss: 'scss', sql: 'sql'
    };
    return langMap[ext] || 'plaintext';
}

/**
 * Apply syntax highlighting with Tokyo Night colors.
 * @param {string} code - Code text
 * @param {string} lang - Language identifier
 * @returns {string} Highlighted text
 * @private
 */
function highlight(code, lang) {
    try {
        if (lang === 'plaintext') return code;
        const result = hljs.highlight(code, { language: lang, ignoreIllegals: true });

        let highlighted = result.value
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            .replace(/&#x27;/g, "'")
            .replace(/&amp;/g, '&');

        highlighted = highlighted
            .replace(/<span class="hljs-meta-string">(.*?)<\/span>/g, c.hex('#9ece6a')('$1'))
            .replace(/<span class="hljs-keyword">(.*?)<\/span>/g, c.hex('#bb9af7')('$1'))
            .replace(/<span class="hljs-string">(.*?)<\/span>/g, c.hex('#9ece6a')('$1'))
            .replace(/<span class="hljs-number">(.*?)<\/span>/g, c.hex('#ff9e64')('$1'))
            .replace(/<span class="hljs-function">(.*?)<\/span>/g, c.hex('#7aa2f7')('$1'))
            .replace(/<span class="hljs-comment">(.*?)<\/span>/g, c.hex('#565f89')('$1'))
            .replace(/<span class="hljs-built_in">(.*?)<\/span>/g, c.hex('#e0af68')('$1'))
            .replace(/<span class="hljs-title.*?">(.*?)<\/span>/g, c.hex('#7aa2f7')('$1'))
            .replace(/<span class="hljs-params">(.*?)<\/span>/g, c.hex('#c0caf5')('$1'))
            .replace(/<span class="hljs-attr">(.*?)<\/span>/g, c.hex('#7dcfff')('$1'))
            .replace(/<span class="hljs-variable">(.*?)<\/span>/g, c.hex('#c0caf5')('$1'))
            .replace(/<span class="hljs-literal">(.*?)<\/span>/g, c.hex('#ff9e64')('$1'))
            .replace(/<span class="hljs-meta">(.*?)<\/span>/g, c.hex('#565f89')('$1'))
            .replace(/<span class="hljs-name">(.*?)<\/span>/g, c.hex('#7aa2f7')('$1'))
            .replace(/<span class="hljs-tag">(.*?)<\/span>/g, c.hex('#f7768e')('$1'))
            .replace(/<span[^>]*>/g, '')
            .replace(/<\/span>/g, '');

        return highlighted;
    } catch (e) {
        return code;
    }
}

class DiffFormatter {
    /**
     * Create a diff between old and new content for a file.
     * @param {string|null} oldContent - Original file content
     * @param {string} newContent - New file content
     * @param {string} filePath - File path (for language detection)
     * @returns {string|null} Formatted diff string, or null if identical
     */
    static formatDiff(oldContent, newContent, filePath) {
        const oldLines = oldContent ? oldContent.split('\n') : [];
        const newLines = newContent.split('\n');

        const diff = this.computeDiff(oldLines, newLines);
        return this.renderDiff(diff, filePath);
    }

    /**
     * Compute a simple line-by-line diff.
     * @param {string[]} oldLines - Original lines
     * @param {string[]} newLines - New lines
     * @returns {Array<{type: string, oldLine?: number, newLine?: number, content: string}>}
     * @private
     */
    static computeDiff(oldLines, newLines) {
        const result = [];
        let i = 0, j = 0;

        while (i < oldLines.length || j < newLines.length) {
            if (i < oldLines.length && j < newLines.length && oldLines[i] === newLines[j]) {
                result.push({ type: 'same', oldLine: i + 1, newLine: j + 1, content: oldLines[i] });
                i++;
                j++;
            } else if (i < oldLines.length && (j >= newLines.length || !newLines.includes(oldLines[i]))) {
                result.push({ type: 'delete', oldLine: i + 1, content: oldLines[i] });
                i++;
            } else if (j < newLines.length) {
                result.push({ type: 'add', newLine: j + 1, content: newLines[j] });
                j++;
            }
        }

        return result;
    }

    /**
     * Render a diff as formatted terminal output.
     * @param {Array} diff - Diff entries from computeDiff
     * @param {string} filePath - File path
     * @returns {string|null} Formatted diff, or null if no changes
     * @private
     */
    static renderDiff(diff, filePath) {
        const lang = detectLanguage(filePath);
        const lines = [];
        const termWidth = process.stdout.columns || 120;
        const contentWidth = termWidth - 3;

        lines.push(c.bold.blue(`\n╭─ ${filePath}`));
        lines.push(c.blue('│'));

        const changes = diff.filter(d => d.type !== 'same');
        if (changes.length === 0) return null;

        for (let i = 0; i < diff.length; i++) {
            const item = diff[i];

            if (item.type === 'same') {
                const hasChangeNearby = diff.slice(Math.max(0, i - 2), Math.min(diff.length, i + 3))
                    .some(d => d.type !== 'same');

                if (hasChangeNearby) {
                    const lineNum = c.dim(String(item.newLine || item.oldLine).padStart(4));
                    const highlighted = highlight(item.content, lang);
                    const text = c.dim(`${lineNum} │   `) + c.dim(highlighted);
                    const visibleLen = stripAnsi(text).length;
                    const padding = ' '.repeat(Math.max(0, contentWidth - visibleLen));
                    lines.push(c.blue('│ ') + c.bgHex('#2a2a2a')(text + padding));
                }
            } else if (item.type === 'delete') {
                const lineNum = c.dim(String(item.oldLine).padStart(4));
                const highlighted = highlight(item.content, lang);
                const text = c.red(`${lineNum} │ - `) + highlighted;
                const visibleLen = stripAnsi(text).length;
                const padding = ' '.repeat(Math.max(0, contentWidth - visibleLen));
                lines.push(c.blue('│ ') + c.bgHex('#2a2a2a')(text + padding));
            } else if (item.type === 'add') {
                const lineNum = c.dim(String(item.newLine).padStart(4));
                const highlighted = highlight(item.content, lang);
                const text = c.green(`${lineNum} │ + `) + highlighted;
                const visibleLen = stripAnsi(text).length;
                const padding = ' '.repeat(Math.max(0, contentWidth - visibleLen));
                lines.push(c.blue('│ ') + c.bgHex('#2a2a2a')(text + padding));
            }
        }

        lines.push(c.blue('╰─'));
        return lines.join('\n');
    }

    /**
     * Format a newly created file.
     * @param {string} content - File content
     * @param {string} filePath - File path
     * @returns {string} Formatted creation display
     */
    static formatCreate(content, filePath) {
        const lang = detectLanguage(filePath);
        const lines = content.split('\n');
        const termWidth = process.stdout.columns || 120;
        const contentWidth = termWidth - 3;

        const output = [
            c.bold.blue(`\n╭─ ${filePath} `) + c.bgGreen.black(` NEW `),
            c.blue('│')
        ];

        lines.slice(0, 10).forEach((line, i) => {
            const lineNum = c.dim(String(i + 1).padStart(4));
            const highlighted = highlight(line, lang);
            const text = c.green(`${lineNum} │ + `) + highlighted;
            const visibleLen = stripAnsi(text).length;
            const padding = ' '.repeat(Math.max(0, contentWidth - visibleLen));
            output.push(c.blue('│ ') + c.bgHex('#2a2a2a')(text + padding));
        });

        if (lines.length > 10) {
            output.push(c.blue('│ ') + c.dim(`... ${lines.length - 10} more lines`));
        }

        output.push(c.blue('╰─'));
        return output.join('\n');
    }
}

module.exports = { DiffFormatter };
