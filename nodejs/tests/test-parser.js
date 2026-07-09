/**
 * @fileoverview Tests for command parser — extracting commands from model output.
 */

const { extractCommands, isCommandLine, isOutputOnly, hasUnclosedQuote } = require('../src/commands/parser');

describe('extractCommands', () => {
  it('extracts commands from ```bash blocks', () => {
    const text = 'Run this:\n```bash\nls -la\n```';
    const cmds = extractCommands(text);
    assert.ok(cmds.includes('ls -la'));
  });

  it('extracts multiple commands from bash blocks', () => {
    const text = '```bash\ncd /tmp\ntouch test.txt\n```';
    const cmds = extractCommands(text);
    assert.ok(cmds.includes('cd /tmp'));
    assert.ok(cmds.includes('touch test.txt'));
  });

  it('extracts commands from longcat format', () => {
    const text = '<longcat_tool_call>ls -la</longcat_arg_value>';
    const cmds = extractCommands(text);
    assert.ok(cmds.includes('ls -la'));
  });

  it('extracts commands from Gemini Bash format', () => {
    const text = 'Bash\nls -la\n\nShell\npwd';
    const cmds = extractCommands(text);
    assert.ok(cmds.includes('ls -la'));
    assert.ok(cmds.includes('pwd'));
  });

  it('ignores comments in commands', () => {
    const text = '```bash\n# This is a comment\nls -la\n```';
    const cmds = extractCommands(text);
    assert.strictEqual(1, cmds.length);
    assert.strictEqual('ls -la', cmds[0]);
  });

  it('returns empty array for text without commands', () => {
    const text = 'This is just a regular response.';
    const cmds = extractCommands(text);
    assert.strictEqual(0, cmds.length);
  });

  it('deduplicates repeated commands', () => {
    const text = '```bash\nls -la\n```\nBash\nls -la';
    const cmds = extractCommands(text);
    assert.strictEqual(1, cmds.filter(c => c === 'ls -la').length);
  });

  it('handles heredoc as single command', () => {
    const text = '```bash\ncat << EOF\nhello world\nEOF\n```';
    const cmds = extractCommands(text);
    assert.strictEqual(1, cmds.length);
    assert.ok(cmds[0].includes('<<'));
  });
});

describe('isCommandLine', () => {
  it('identifies valid command starts', () => {
    assert.ok(isCommandLine('ls -la'));
    assert.ok(isCommandLine('./script.sh'));
    assert.ok(isCommandLine('/usr/bin/python'));
    assert.ok(isCommandLine('$EDITOR file'));
  });

  it('rejects data-only lines', () => {
    assert.strictEqual(false, isCommandLine('0 1 2 3 4'));
    assert.strictEqual(false, isCommandLine('  1  2  3  '));
  });

  it('accepts comment lines', () => {
    assert.ok(isCommandLine('# this is a comment'));
  });
});

describe('isOutputOnly', () => {
  it('identifies bare absolute paths as output', () => {
    assert.ok(isOutputOnly('/usr/bin/python'));
    assert.ok(isOutputOnly('/home/user/file.txt'));
  });

  it('rejects paths with arguments', () => {
    assert.strictEqual(false, isOutputOnly('/usr/bin/python script.py'));
  });

  it('rejects relative paths', () => {
    assert.strictEqual(false, isOutputOnly('./script.sh'));
  });
});

describe('hasUnclosedQuote', () => {
  it('detects unclosed single quotes', () => {
    assert.ok(hasUnclosedQuote("echo 'hello"));
  });

  it('detects unclosed double quotes', () => {
    assert.ok(hasUnclosedQuote('echo "hello'));
  });

  it('accepts properly closed quotes', () => {
    assert.strictEqual(false, hasUnclosedQuote("echo 'hello'"));
    assert.strictEqual(false, hasUnclosedQuote('echo "hello"'));
  });
});
