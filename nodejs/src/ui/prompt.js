class PromptManager {
    constructor() {
        this._history = [];
    }

    init() {
        this._sigintDefault = () => { process.stdout.write('\n'); process.exit(0); };
        process.on('SIGINT', this._sigintDefault);
    }

    _drain() {
        return new Promise((resolve) => {
            if (process.stdin.isTTY) process.stdin.setRawMode(true);
            process.stdin.resume();
            const discard = () => {};
            process.stdin.on('data', discard);
            setImmediate(() => {
                process.stdin.removeListener('data', discard);
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
                if (process.stdin.isTTY) process.stdin.setRawMode(false);
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
            let cursor = 0;       // cursor position within buffer
            let histIdx = -1;     // -1 = current input
            let saved = '';       // saved current input when browsing history
            let inPaste = false;
            let done = false;

            // Redraw from cursor to end of buffer, then reposition cursor
            const redraw = () => {
                // Erase from current position to end of line, rewrite suffix, reposition
                const suffix = buffer.slice(cursor);
                process.stdout.write('\x1b[K' + suffix + (suffix ? `\x1b[${suffix.length}D` : ''));
            };

            // Replace entire line content (for history navigation)
            const setLine = (text) => {
                // Move to start of input area, clear to end, write new text
                if (cursor > 0) process.stdout.write(`\x1b[${cursor}D`);
                process.stdout.write('\x1b[K' + text);
                buffer = text;
                cursor = text.length;
            };

            const finish = (text) => {
                if (done) return;
                done = true;
                process.stdout.write('\x1b[?2004l\n');
                if (process.stdin.isTTY) process.stdin.setRawMode(false);
                process.stdin.removeListener('data', onData);
                const result = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
                if (result.trim()) {
                    this._history.unshift(result);
                    if (this._history.length > 200) this._history.pop();
                }
                resolve(result);
            };

            const onData = (buf) => {
                let str = buf.toString();
                if (str === '\x03') { process.stdout.write('\n'); process.exit(0); }

                // Bracketed paste start
                if (str.includes('\x1b[200~')) {
                    const idx = str.indexOf('\x1b[200~');
                    const before = str.slice(0, idx);
                    if (before) {
                        buffer = buffer.slice(0, cursor) + before + buffer.slice(cursor);
                        cursor += before.length;
                        process.stdout.write(before);
                        redraw();
                    }
                    inPaste = true;
                    str = str.slice(idx + 6);
                }

                // Bracketed paste end
                if (inPaste && str.includes('\x1b[201~')) {
                    const endIdx = str.indexOf('\x1b[201~');
                    const paste = str.slice(0, endIdx);
                    buffer = buffer.slice(0, cursor) + paste + buffer.slice(cursor);
                    cursor += paste.length;
                    process.stdout.write(paste.replace(/\r(?!\n)/g, '\r\n'));
                    inPaste = false;
                    str = str.slice(endIdx + 6);
                }

                if (inPaste) {
                    buffer = buffer.slice(0, cursor) + str + buffer.slice(cursor);
                    cursor += str.length;
                    process.stdout.write(str.replace(/\r\n/g, '\r\n').replace(/\r(?!\n)/g, '\r\n'));
                    return;
                }

                // Enter
                if (str === '\r' || str === '\n') {
                    finish(buffer.trimEnd());
                    return;
                }

                // Arrow keys
                if (str === '\x1b[D') { // left
                    if (cursor > 0) { cursor--; process.stdout.write('\x1b[D'); }
                    return;
                }
                if (str === '\x1b[C') { // right
                    if (cursor < buffer.length) { cursor++; process.stdout.write('\x1b[C'); }
                    return;
                }
                if (str === '\x1b[A') { // up — older history
                    if (this._history.length === 0) return;
                    if (histIdx === -1) saved = buffer;
                    if (histIdx < this._history.length - 1) histIdx++;
                    setLine(this._history[histIdx]);
                    return;
                }
                if (str === '\x1b[B') { // down — newer history
                    if (histIdx === -1) return;
                    histIdx--;
                    setLine(histIdx === -1 ? saved : this._history[histIdx]);
                    return;
                }
                // Home / Ctrl-A
                if (str === '\x1b[H' || str === '\x01') {
                    if (cursor > 0) { process.stdout.write(`\x1b[${cursor}D`); cursor = 0; }
                    return;
                }
                // End / Ctrl-E
                if (str === '\x1b[F' || str === '\x05') {
                    if (cursor < buffer.length) {
                        process.stdout.write(`\x1b[${buffer.length - cursor}C`);
                        cursor = buffer.length;
                    }
                    return;
                }

                // Tab completion (only when cursor is at end)
                if (str === '\t') {
                    if (cursor !== buffer.length) return;
                    const matches = completions.filter(c => c.startsWith(buffer));
                    if (matches.length === 1) {
                        const completion = matches[0].slice(buffer.length);
                        buffer += completion;
                        cursor += completion.length;
                        process.stdout.write(completion);
                    } else if (matches.length > 1) {
                        let prefix = matches[0];
                        for (const m of matches) while (!m.startsWith(prefix)) prefix = prefix.slice(0, -1);
                        if (prefix.length > buffer.length) {
                            const completion = prefix.slice(buffer.length);
                            buffer += completion;
                            cursor += completion.length;
                            process.stdout.write(completion);
                        } else {
                            const labels = matches.map(m => m.replace(/^\/model /, ''));
                            process.stdout.write('\n  ' + labels.join('  ') + '\n' + promptText + buffer);
                        }
                    }
                    return;
                }

                // Backspace
                if (str === '\x7f') {
                    if (cursor > 0) {
                        buffer = buffer.slice(0, cursor - 1) + buffer.slice(cursor);
                        cursor--;
                        process.stdout.write('\b');
                        redraw();
                    }
                    return;
                }

                // Delete key
                if (str === '\x1b[3~') {
                    if (cursor < buffer.length) {
                        buffer = buffer.slice(0, cursor) + buffer.slice(cursor + 1);
                        redraw();
                    }
                    return;
                }

                // Printable characters
                if (str && !str.startsWith('\x1b')) {
                    buffer = buffer.slice(0, cursor) + str + buffer.slice(cursor);
                    cursor += str.length;
                    process.stdout.write(str);
                    redraw();
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
