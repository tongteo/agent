/**
 * @fileoverview Tests for IntentParser — natural language to tool call parsing.
 */

const { IntentParser } = require('../src/core/agent');

describe('IntentParser.parseUserInput', () => {
  it('parses "run <binary>" command', () => {
    const result = IntentParser.parseUserInput('run fermat');
    assert.strictEqual('execute', result.tool);
  });

  it('parses "execute <binary>" command', () => {
    const result = IntentParser.parseUserInput('execute ./test');
    assert.strictEqual('execute', result.tool);
  });

  it('parses "compile <file.c>" command', () => {
    const result = IntentParser.parseUserInput('compile main.c');
    assert.strictEqual('execute', result.tool);
    assert.ok(result.params.command.includes('gcc'));
  });

  it('parses "gcc <file>" command', () => {
    const result = IntentParser.parseUserInput('gcc test.c');
    assert.strictEqual('execute', result.tool);
  });

  it('parses "ls" and "list files"', () => {
    const ls = IntentParser.parseUserInput('ls');
    assert.strictEqual('list_dir', ls.tool);
    assert.strictEqual('.', ls.params.path);

    const list = IntentParser.parseUserInput('list files');
    assert.strictEqual('list_dir', list.tool);
  });

  it('returns null for unrecognized input', () => {
    const result = IntentParser.parseUserInput('What is the meaning of life?');
    assert.strictEqual(null, result);
  });
});

describe('IntentParser.parse', () => {
  it('parses "compile main.c" from free-form text', () => {
    const calls = IntentParser.parse('Let me compile main.c for you');
    assert.strictEqual(1, calls.length);
    assert.strictEqual('execute', calls[0].tool);
    assert.ok(calls[0].params.command.includes('gcc'));
  });

  it('parses "run ./fermat" from text', () => {
    const calls = IntentParser.parse('Running the ./fermat program');
    assert.strictEqual(1, calls.length);
    assert.strictEqual('execute', calls[0].tool);
  });

  it('parses "read README.md" from text', () => {
    const calls = IntentParser.parse('Let me read README.md for you');
    assert.strictEqual(1, calls.length);
    assert.strictEqual('read_file', calls[0].tool);
    assert.strictEqual('README.md', calls[0].params.path);
  });

  it('returns empty for long explanatory text', () => {
    const long = 'A'.repeat(2500);
    const calls = IntentParser.parse(long);
    assert.strictEqual(0, calls.length);
  });

  it('parses "list files in src" from text', () => {
    const calls = IntentParser.parse('Let me list the files in src directory');
    assert.strictEqual(1, calls.length);
    assert.strictEqual('list_dir', calls[0].tool);
    assert.strictEqual('src', calls[0].params.path);
  });

  it('uses context.lastFile as fallback', () => {
    const calls = IntentParser.parse('Now read it', { lastFile: 'main.js' });
    assert.strictEqual(1, calls.length);
    assert.strictEqual('read_file', calls[0].tool);
    assert.strictEqual('main.js', calls[0].params.path);
  });

  it('returns empty for text with no recognizable actions', () => {
    const calls = IntentParser.parse('That looks great. Well done!');
    assert.strictEqual(0, calls.length);
  });
});
