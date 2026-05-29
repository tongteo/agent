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

// Renders a complete markdown response: code blocks highlighted, bold/inline-code styled
function renderMarkdown(text) {
    const lines = text.split('\n');
    const out = [];
    let inCode = false;
    let lang = '';
    let codeLines = [];

    for (const line of lines) {
        const fence = line.match(/^```(\w*)$/);
        if (fence && !inCode) {
            inCode = true;
            lang = fence[1] || 'bash';
            codeLines = [];
            continue;
        }
        if (inCode && line.trim() === '```') {
            const code = codeLines.join('\n');
            const header = chalk.bgBlack.cyan(` ${lang} `);
            let body;
            try { body = highlight(code, { language: lang, ignoreIllegals: true }); }
            catch { body = chalk.white(code); }
            out.push(header);
            out.push(body.split('\n').map(l => chalk.dim('│ ') + l).join('\n'));
            inCode = false;
            continue;
        }
        if (inCode) { codeLines.push(line); continue; }

        // inline formatting
        const formatted = line
            .replace(/\*\*(.+?)\*\*/g, (_, t) => chalk.bold(t))
            .replace(/`([^`]+)`/g, (_, t) => chalk.cyan(t))
            .replace(/^(#{1,3})\s+(.+)/, (_, h, t) => chalk.bold.underline(t))
            .replace(/^\|\s*(.+)/, (_, t) => chalk.dim('│ ') + t);
        out.push(formatted);
    }

    // flush unclosed code block
    if (inCode && codeLines.length) {
        out.push(chalk.dim('│ ') + codeLines.join('\n' + chalk.dim('│ ')));
    }

    return out.join('\n');
}

module.exports = { formatOutput, formatMath, renderMarkdown };
