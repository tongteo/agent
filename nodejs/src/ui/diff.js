const chalk = require('chalk');

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
        lines.push(chalk.cyan(`\n📝 ${filePath}`));
        
        let contextStart = 0;
        const changes = diff.filter(d => d.type !== 'same');
        
        if (changes.length === 0) return '';
        
        for (let i = 0; i < diff.length; i++) {
            const item = diff[i];
            
            if (item.type === 'same') {
                const hasChangeNearby = diff.slice(Math.max(0, i - 2), Math.min(diff.length, i + 3))
                    .some(d => d.type !== 'same');
                
                if (hasChangeNearby) {
                    const oldNum = item.oldLine ? String(item.oldLine).padStart(4) : '    ';
                    const newNum = item.newLine ? String(item.newLine).padStart(4) : '    ';
                    lines.push(chalk.gray(`  ${oldNum}, ${newNum}: ${item.content}`));
                }
            } else if (item.type === 'delete') {
                const oldNum = String(item.oldLine).padStart(4);
                lines.push(chalk.red(`- ${oldNum}    : ${item.content}`));
            } else if (item.type === 'add') {
                const newNum = String(item.newLine).padStart(4);
                lines.push(chalk.green(`+     , ${newNum}: ${item.content}`));
            }
        }
        
        return lines.join('\n');
    }

    static formatCreate(content, filePath) {
        const lines = content.split('\n');
        const output = [chalk.cyan(`\n📝 ${filePath} (new file)`)];
        
        lines.slice(0, 10).forEach((line, i) => {
            output.push(chalk.green(`+     , ${String(i + 1).padStart(4)}: ${line}`));
        });
        
        if (lines.length > 10) {
            output.push(chalk.gray(`  ... ${lines.length - 10} more lines`));
        }
        
        return output.join('\n');
    }
}

module.exports = { DiffFormatter };
