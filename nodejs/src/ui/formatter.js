const chalk = require('chalk');

let highlight;
try {
    highlight = require('cli-highlight').highlight;
} catch (e) {
    highlight = (code) => code;
}

function formatOutput(output, language = 'bash') {
    if (!output || output.length === 0) return '(no output)';
    
    const maxLines = 50;
    const lines = output.split('\n');
    
    if (lines.length > maxLines) {
        const truncated = lines.slice(0, maxLines).join('\n');
        const remaining = lines.length - maxLines;
        return highlight(truncated, { language }) + chalk.yellow(`\n... (${remaining} more lines, output truncated)`);
    }
    
    try {
        return highlight(output, { language });
    } catch (e) {
        return output;
    }
}

function formatMath(text) {
    return text
        .replace(/(\d+)\s*\+\s*(\d+)\s*=\s*(\d+)/g, '$1 + $2 = $3')
        .replace(/(\d+)\s*-\s*(\d+)\s*=\s*(\d+)/g, '$1 - $2 = $3')
        .replace(/(\d+)\s*\*\s*(\d+)\s*=\s*(\d+)/g, '$1 × $2 = $3')
        .replace(/(\d+)\s*×\s*(\d+)\s*=\s*(\d+)/g, '$1 × $2 = $3')
        .replace(/(\d+)\s*\/\s*(\d+)\s*=\s*(\d+)/g, '$1 ÷ $2 = $3');
}

module.exports = { formatOutput, formatMath };
