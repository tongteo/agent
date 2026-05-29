function isCommandLine(line) {
    const t = line.trim();
    if (!t || t.startsWith('#')) return true;
    // Data lines: only digits and spaces (e.g. "0 1 2 3")
    if (/^[\d\s]+$/.test(t)) return false;
    // A valid command start: letter, path (./,/,~), variable ($), or special chars
    return /^[a-zA-Z$.\/~`\-\[\{_]/.test(t);
}

// Bare absolute/relative path with no arguments = output, not a command
function isOutputOnly(cmd) {
    return /^\/[^\s]+$/.test(cmd) || /^\~\/[^\s]+$/.test(cmd);
}

function hasUnclosedQuote(text) {
    let inSingle = false, inDouble = false;
    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (c === "'" && !inDouble) inSingle = !inSingle;
        else if (c === '"' && !inSingle) inDouble = !inDouble;
    }
    return inSingle || inDouble;
}

function extractCommands(text) {
    const commands = [];

    // Pattern 0: owl-alpha longcat format
    const longcatRegex = /<longcat_tool_call>([\s\S]*?)<\/longcat_arg_value>/g;
    let lm;
    while ((lm = longcatRegex.exec(text)) !== null) {
        lm[1].trim().split('\n').forEach(line => {
            const cmd = line.trim();
            if (cmd && !cmd.startsWith('#')) commands.push(cmd);
        });
    }
    if (commands.length) return commands;
    
    // Pattern 1: Only ```bash / ```sh / ```shell blocks (NOT cpp, python, etc.)
    const codeBlocks = text.match(/```(?:bash|sh|shell)\s*\n([\s\S]*?)```/g);
    if (codeBlocks) {
        codeBlocks.forEach(block => {
            const content = block.replace(/```(?:bash|sh|shell)\s*\n?/, '').replace(/```\s*$/, '').trim();
            
            // Keep as single command if: heredoc, line continuation, unclosed quotes,
            // or any line looks like data (not a command start)
            const lines = content.split('\n').filter(l => l.trim() && !l.trim().startsWith('#'));
            const needsWhole = content.includes('<<') || content.includes('\\\n')
                || hasUnclosedQuote(content)
                || lines.some((l, i) => i > 0 && !isCommandLine(l));
            if (needsWhole) {
                if (!content.startsWith('#')) commands.push(content);
            } else {
                content.split('\n').forEach(line => {
                    const cmd = line.trim();
                    if (cmd && !cmd.startsWith('#') && !isOutputOnly(cmd)) commands.push(cmd);
                });
            }
        });
    }
    
    // Pattern 2: Gemini format "Bash\n..."
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
        if (/^(Bash|bash|Shell|shell)\s*$/.test(lines[i])) {
            i++;
            if (i >= lines.length) continue;
            
            const cmdStart = lines[i];
            if (cmdStart.includes('<<')) {
                const eofMatch = cmdStart.match(/<<\s*'?(\w+)'?/);
                if (eofMatch) {
                    const marker = eofMatch[1];
                    let heredoc = [cmdStart];
                    i++;
                    while (i < lines.length && lines[i].trim() !== marker) {
                        heredoc.push(lines[i]);
                        i++;
                    }
                    if (i < lines.length) heredoc.push(lines[i]);
                    commands.push(heredoc.join('\n'));
                }
            } else {
                let cmds = [cmdStart];
                i++;
                while (i < lines.length && lines[i].trim() !== '' && !/^(Bash|bash|Shell|shell)/.test(lines[i])) {
                    cmds.push(lines[i]);
                    i++;
                }
                cmds.forEach(cmd => {
                    const c = cmd.trim();
                    if (c && !c.startsWith('#') && !commands.includes(c)) {
                        commands.push(c);
                    }
                });
                i--;
            }
        }
    }
    
    return [...new Set(commands)];
}

module.exports = { extractCommands };
