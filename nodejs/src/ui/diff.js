const chalk = require('chalk');
const hljs = require('highlight.js');

// Force colors for diff output
const c = new chalk.Instance({ level: 3 });

// Detect language from file extension
function detectLanguage(filePath) {
    const ext = filePath.split('.').pop();
    const langMap = {
        'js': 'javascript', 'ts': 'typescript', 'jsx': 'javascript', 'tsx': 'typescript',
        'py': 'python', 'rb': 'ruby', 'go': 'go', 'rs': 'rust', 'java': 'java',
        'c': 'c', 'cpp': 'cpp', 'cc': 'cpp', 'h': 'c', 'hpp': 'cpp',
        'sh': 'bash', 'bash': 'bash', 'zsh': 'bash',
        'json': 'json', 'yaml': 'yaml', 'yml': 'yaml', 'xml': 'xml',
        'html': 'html', 'css': 'css', 'scss': 'scss', 'sql': 'sql'
    };
    return langMap[ext] || 'plaintext';
}

// Apply syntax highlighting
function highlight(code, lang) {
    try {
        if (lang === 'plaintext') return code;
        const result = hljs.highlight(code, { language: lang, ignoreIllegals: true });
        return result.value
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            .replace(/&#x27;/g, "'")
            .replace(/&amp;/g, '&')
            .replace(/<span class="hljs-keyword">(.*?)<\/span>/g, c.magenta('$1'))
            .replace(/<span class="hljs-string">(.*?)<\/span>/g, c.green('$1'))
            .replace(/<span class="hljs-number">(.*?)<\/span>/g, c.cyan('$1'))
            .replace(/<span class="hljs-function">(.*?)<\/span>/g, c.blue('$1'))
            .replace(/<span class="hljs-comment">(.*?)<\/span>/g, c.dim('$1'))
            .replace(/<span class="hljs-built_in">(.*?)<\/span>/g, c.yellow('$1'))
            .replace(/<span class="hljs-title.*?">(.*?)<\/span>/g, c.blue('$1'))
            .replace(/<span class="hljs-params">(.*?)<\/span>/g, c.white('$1'))
            .replace(/<span class="hljs-attr">(.*?)<\/span>/g, c.cyan('$1'))
            .replace(/<span class="hljs-variable">(.*?)<\/span>/g, c.white('$1'))
            .replace(/<span class="hljs-literal">(.*?)<\/span>/g, c.cyan('$1'))
            .replace(/<span class="hljs-meta">(.*?)<\/span>/g, c.dim('$1'))
            .replace(/<span class="hljs-name">(.*?)<\/span>/g, c.blue('$1'))
            .replace(/<span class="hljs-tag">(.*?)<\/span>/g, c.blue('$1'))
            .replace(/<span[^>]*>(.*?)<\/span>/g, '$1');
    } catch (e) {
        return code;
    }
}

class DiffFormatter {
    static formatDiff(oldContent, newContent, filePath) {
        const oldLines = oldContent ? oldContent.split('\n') : [];
        const newLines = newContent.split('\n');
        
        const diff = this.computeDiff(oldLines, newLines);
        return this.renderDiff(diff, filePath);
    }

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

    static renderDiff(diff, filePath) {
        const lang = detectLanguage(filePath);
        const lines = [];
        lines.push(c.bold.blue(`\n╭─ ${filePath}`));
        lines.push(c.blue('│'));
        
        const changes = diff.filter(d => d.type !== 'same');
        if (changes.length === 0) return '';
        
        for (let i = 0; i < diff.length; i++) {
            const item = diff[i];
            
            if (item.type === 'same') {
                const hasChangeNearby = diff.slice(Math.max(0, i - 2), Math.min(diff.length, i + 3))
                    .some(d => d.type !== 'same');
                
                if (hasChangeNearby) {
                    const lineNum = c.dim(String(item.newLine || item.oldLine).padStart(4));
                    const highlighted = highlight(item.content, lang);
                    lines.push(c.blue('│ ') + c.dim(`${lineNum} │   `) + c.dim(highlighted));
                }
            } else if (item.type === 'delete') {
                const lineNum = c.dim(String(item.oldLine).padStart(4));
                const highlighted = highlight(item.content, lang);
                lines.push(c.blue('│ ') + c.red(`${lineNum} │ - `) + highlighted);
            } else if (item.type === 'add') {
                const lineNum = c.dim(String(item.newLine).padStart(4));
                const highlighted = highlight(item.content, lang);
                lines.push(c.blue('│ ') + c.green(`${lineNum} │ + `) + highlighted);
            }
        }
        
        lines.push(c.blue('╰─'));
        return lines.join('\n');
    }

    static formatCreate(content, filePath) {
        const lang = detectLanguage(filePath);
        const lines = content.split('\n');
        const output = [
            c.bold.blue(`\n╭─ ${filePath} `) + c.bgGreen.black(` NEW `),
            c.blue('│')
        ];
        
        lines.slice(0, 10).forEach((line, i) => {
            const lineNum = c.dim(String(i + 1).padStart(4));
            const highlighted = highlight(line, lang);
            output.push(c.blue('│ ') + c.green(`${lineNum} │ + `) + highlighted);
        });
        
        if (lines.length > 10) {
            output.push(c.blue('│ ') + c.dim(`... ${lines.length - 10} more lines`));
        }
        
        output.push(c.blue('╰─'));
        return output.join('\n');
    }
}

module.exports = { DiffFormatter };
