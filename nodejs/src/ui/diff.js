const chalk = require('chalk');

// Force colors for diff output
const c = new chalk.Instance({ level: 3 });

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
                    lines.push(c.blue('│ ') + c.dim(`${lineNum} │   ${item.content}`));
                }
            } else if (item.type === 'delete') {
                const lineNum = c.dim(String(item.oldLine).padStart(4));
                lines.push(c.blue('│ ') + c.bgRed.black(` ${lineNum} │ - ${item.content} `));
            } else if (item.type === 'add') {
                const lineNum = c.dim(String(item.newLine).padStart(4));
                lines.push(c.blue('│ ') + c.bgGreen.black(` ${lineNum} │ + ${item.content} `));
            }
        }
        
        lines.push(c.blue('╰─'));
        return lines.join('\n');
    }

    static formatCreate(content, filePath) {
        const lines = content.split('\n');
        const output = [
            c.bold.blue(`\n╭─ ${filePath} `) + c.bgGreen.black(` NEW `),
            c.blue('│')
        ];
        
        lines.slice(0, 10).forEach((line, i) => {
            const lineNum = c.dim(String(i + 1).padStart(4));
            output.push(c.blue('│ ') + c.bgGreen.black(` ${lineNum} │ + ${line} `));
        });
        
        if (lines.length > 10) {
            output.push(c.blue('│ ') + c.dim(`... ${lines.length - 10} more lines`));
        }
        
        output.push(c.blue('╰─'));
        return output.join('\n');
    }
}

module.exports = { DiffFormatter };
