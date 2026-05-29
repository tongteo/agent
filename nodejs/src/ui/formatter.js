const chalk = require('chalk');

let highlight;
try {
    const { highlight: hl } = require('cli-highlight');
    const tokyoNight = {
        keyword:        chalk.hex('#bb9af7'),
        built_in:       chalk.hex('#7aa2f7'),
        type:           chalk.hex('#2ac3de'),
        literal:        chalk.hex('#ff9e64'),
        number:         chalk.hex('#ff9e64'),
        regexp:         chalk.hex('#b4f9f8'),
        string:         chalk.hex('#9ece6a'),
        subst:          chalk.hex('#c0caf5'),
        symbol:         chalk.hex('#9ece6a'),
        class:          chalk.hex('#2ac3de'),
        function:       chalk.hex('#7aa2f7'),
        title:          chalk.hex('#7aa2f7'),
        params:         chalk.hex('#c0caf5'),
        comment:        chalk.hex('#565f89'),
        doctag:         chalk.hex('#565f89'),
        meta:           chalk.hex('#89ddff'),
        'meta-keyword': chalk.hex('#bb9af7'),
        'meta-string':  chalk.hex('#9ece6a'),
        attr:           chalk.hex('#73daca'),
        attribute:      chalk.hex('#73daca'),
        name:           chalk.hex('#f7768e'),
        tag:            chalk.hex('#f7768e'),
        variable:       chalk.hex('#c0caf5'),
        'template-variable': chalk.hex('#ff9e64'),
        'template-tag': chalk.hex('#bb9af7'),
        selector_id:    chalk.hex('#7aa2f7'),
        'selector-class': chalk.hex('#2ac3de'),
        'selector-attr': chalk.hex('#73daca'),
        'selector-pseudo': chalk.hex('#bb9af7'),
        addition:       chalk.hex('#9ece6a'),
        deletion:       chalk.hex('#f7768e'),
        default:        chalk.hex('#c0caf5'),
    };
    highlight = (code, opts = {}) => hl(code, { ...opts, theme: tokyoNight, ignoreIllegals: true });
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
            try { body = highlight(code, { language: lang }); }
            catch { body = chalk.hex('#c0caf5')(code); }
            const bodyLines = body.split('\n');
            const MAX = 20;
            const shown = bodyLines.slice(0, MAX);
            const hidden = bodyLines.length - MAX;
            const rendered = shown.map(l => chalk.dim('│ ') + l).join('\n')
                + (hidden > 0 ? '\n' + chalk.dim(`│ `) + chalk.yellow(`... (${hidden} more lines)`) : '');
            out.push(header);
            out.push(rendered);
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
