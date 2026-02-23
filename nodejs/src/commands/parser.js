function extractCommands(text) {
    const commands = [];
    
    // Pattern 1: Standard code blocks ```bash ... ```
    const codeBlocks = text.match(/```(?:bash|sh|shell)?\s*\n([\s\S]*?)```/g);
    if (codeBlocks) {
        codeBlocks.forEach(block => {
            const content = block.replace(/```(?:bash|sh|shell)?\s*\n?/, '').replace(/```\s*$/, '').trim();
            
            if (content.includes('<<') || content.includes('\\\n')) {
                if (!content.startsWith('#')) commands.push(content);
            } else {
                content.split('\n').forEach(line => {
                    const cmd = line.trim();
                    if (cmd && !cmd.startsWith('#')) commands.push(cmd);
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
    
    return commands;
}

module.exports = { extractCommands };
