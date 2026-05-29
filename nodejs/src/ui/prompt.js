class PromptManager {
    constructor() {}

    init() {
        process.on('SIGINT', () => { process.stdout.write('\n'); process.exit(0); });
    }

    // Drain any buffered stdin data before reading new input
    _drain() {
        return new Promise((resolve) => {
            process.stdin.setRawMode(true);
            process.stdin.resume();
            // Give event loop a tick to deliver any pending buffered data, then discard it
            const discard = () => {};
            process.stdin.on('data', discard);
            setImmediate(() => {
                process.stdin.removeListener('data', discard);
                // One more tick to be safe
                setImmediate(resolve);
            });
        });
    }

    async confirm(promptText) {
        await this._drain();
        process.stdout.write(promptText);
        return new Promise((resolve) => {
            let done = false;

            const onData = (buf) => {
                if (done) return;
                const ch = buf.toString()[0];
                if (ch === '\x03') { process.stdout.write('\n'); process.exit(0); }
                if (!/^[yna\r\n]$/i.test(ch)) return;
                done = true;
                process.stdin.setRawMode(false);
                process.stdin.removeListener('data', onData);
                const ans = (ch === '\r' || ch === '\n') ? 'y' : ch.toLowerCase();
                process.stdout.write(ans + '\n');
                resolve(ans);
            };

            process.stdin.on('data', onData);
        });
    }

    async ask(promptText, completions = ['exit', 'clear', '/model ']) {
        await this._drain();
        process.stdout.write('\x1b[?2004h');
        process.stdout.write(promptText);

        return new Promise((resolve) => {
            let buffer = '';
            let inPaste = false;
            let done = false;

            const finish = (text) => {
                if (done) return;
                done = true;
                process.stdout.write('\x1b[?2004l\n');
                process.stdin.setRawMode(false);
                process.stdin.removeListener('data', onData);
                resolve(text.replace(/\r\n/g, '\n').replace(/\r/g, '\n'));
            };

            const onData = (buf) => {
                let str = buf.toString();
                if (str === '\x03') { process.stdout.write('\n'); process.exit(0); }

                // Handle bracketed paste start
                if (str.includes('\x1b[200~')) {
                    const startIdx = str.indexOf('\x1b[200~') + 6;
                    // Any text before the marker is normal input
                    const before = str.slice(0, str.indexOf('\x1b[200~'));
                    if (before) { buffer += before; process.stdout.write(before); }
                    inPaste = true;
                    str = str.slice(startIdx);
                }

                // Handle bracketed paste end
                if (inPaste && str.includes('\x1b[201~')) {
                    const endIdx = str.indexOf('\x1b[201~');
                    const pasteContent = str.slice(0, endIdx);
                    buffer += pasteContent;
                    process.stdout.write(pasteContent.replace(/\r(?!\n)/g, '\r\n'));
                    inPaste = false;
                    str = str.slice(endIdx + 6);
                    // Don't finish yet — wait for Enter
                }

                if (inPaste) {
                    buffer += str;
                    process.stdout.write(str.replace(/\r\n/g, '\r\n').replace(/\r(?!\n)/g, '\r\n'));
                    return;
                }

                if (str === '\r' || str === '\n') {
                    finish(buffer.trimEnd());
                } else if (str === '\t') {
                    const matches = completions.filter(c => c.startsWith(buffer));
                    if (matches.length === 1) {
                        const completion = matches[0].slice(buffer.length);
                        buffer += completion;
                        process.stdout.write(completion);
                    } else if (matches.length > 1) {
                        process.stdout.write('\n  ' + matches.join('  ') + '\n' + promptText + buffer);
                    }
                } else if (str === '\x7f') {
                    if (buffer.length > 0) { buffer = buffer.slice(0, -1); process.stdout.write('\b \b'); }
                } else if (str && !str.startsWith('\x1b')) {
                    buffer += str;
                    process.stdout.write(str);
                }
            };

            process.stdin.on('data', onData);
        });
    }

    close() {
        process.stdout.write('\x1b[?2004l');
    }
}

module.exports = { PromptManager };
