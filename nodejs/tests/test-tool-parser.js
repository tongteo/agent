/**
 * @fileoverview Tests for ToolParser — parsing XML tool calls from model responses.
 * Also covers JSON format and HTML-escaped formats.
 */

const { ToolParser } = require('../src/core/agent');

describe('ToolParser', () => {
  it('parses basic <tool>/<params> XML format', () => {
    const input = '<tool>read_file</tool>\n<params>{"path": "test.txt"}</params>';
    const calls = ToolParser.parse(input);
    assert.strictEqual(1, calls.length);
    assert.strictEqual('read_file', calls[0].tool);
    assert.strictEqual('test.txt', calls[0].params.path);
  });

  it('parses multiple tool calls', () => {
    const input = '<tool>read_file</tool>\n<params>{"path": "a.txt"}</params>\n<tool>list_dir</tool>\n<params>{"path": "."}</params>';
    const calls = ToolParser.parse(input);
    assert.strictEqual(2, calls.length);
    assert.strictEqual('read_file', calls[0].tool);
    assert.strictEqual('list_dir', calls[1].tool);
  });

  it('parses longcat format (owl-alpha)', () => {
    const input = '<longcat_tool_call>ls -la</longcat_arg_value>';
    const calls = ToolParser.parse(input);
    assert.strictEqual(1, calls.length);
    assert.strictEqual('bash', calls[0].tool);
    assert.strictEqual('ls -la', calls[0].params.command);
  });

  it('handles HTML-escaped XML entities (Gemini)', () => {
    const input = '&lt;tool&gt;read_file&lt;/tool&gt;\n&lt;params&gt;{"path": "test.txt"}&lt;/params&gt;';
    const calls = ToolParser.parse(input);
    assert.strictEqual(1, calls.length);
    assert.strictEqual('read_file', calls[0].tool);
  });

  it('strips markdown code fences around tool calls', () => {
    const input = '```xml\n<tool>list_dir</tool>\n<params>{"path": "."}</params>\n```';
    const calls = ToolParser.parse(input);
    assert.strictEqual(1, calls.length);
    assert.strictEqual('list_dir', calls[0].tool);
  });

  it('handles JSON with newlines in content', () => {
    const input = '<tool>write_file</tool>\n<params>{"path": "test.txt", "content": "line1\\nline2"}</params>';
    const calls = ToolParser.parse(input);
    assert.strictEqual(1, calls.length);
    assert.strictEqual('write_file', calls[0].tool);
    assert.ok(calls[0].params.content.includes('line1'));
  });

  it('returns empty array for non-tool text', () => {
    const input = 'I am a helpful assistant. How can I help you today?';
    const calls = ToolParser.parse(input);
    assert.strictEqual(0, calls.length);
  });

  it('handles empty params gracefully', () => {
    const input = '<tool>list_dir</tool>\n<params>{}</params>';
    const calls = ToolParser.parse(input);
    assert.strictEqual(1, calls.length);
    assert.deepStrictEqual({}, calls[0].params);
  });

  // NEW: JSON format tests
  it('parses JSON format: tool_name followed by JSON on next line', () => {
    const input = 'write_file\n{"path":"radix_sort.c","content":"#include <stdio.h>\\nint main() { return 0; }"}';
    const calls = ToolParser.parse(input);
    assert.strictEqual(1, calls.length);
    assert.strictEqual('write_file', calls[0].tool);
    assert.strictEqual('radix_sort.c', calls[0].params.path);
    assert.ok(calls[0].params.content.includes('#include'));
  });

  it('parses JSON format inline: tool_name {json} on same line', () => {
    const input = 'write_file {"path":"hello.txt","content":"Hello World"}';
    const calls = ToolParser.parse(input);
    assert.strictEqual(1, calls.length);
    assert.strictEqual('write_file', calls[0].tool);
    assert.strictEqual('hello.txt', calls[0].params.path);
  });

  it('parses execute with JSON format', () => {
    const input = 'execute\n{"command":"gcc test.c -o test"}';
    const calls = ToolParser.parse(input);
    assert.strictEqual(1, calls.length);
    assert.strictEqual('execute', calls[0].tool);
    assert.strictEqual('gcc test.c -o test', calls[0].params.command);
  });

  it('parses multiple JSON format tool calls', () => {
    const input = 'write_file\n{"path":"a.txt","content":"aaa"}\nexecute\n{"command":"cat a.txt"}';
    const calls = ToolParser.parse(input);
    assert.strictEqual(2, calls.length);
    assert.strictEqual('write_file', calls[0].tool);
    assert.strictEqual('execute', calls[1].tool);
  });

  it('parses bash with JSON format', () => {
    const input = 'bash\n{"command":"ls -la"}';
    const calls = ToolParser.parse(input);
    assert.strictEqual(1, calls.length);
    assert.strictEqual('bash', calls[0].tool);
    assert.strictEqual('ls -la', calls[0].params.command);
  });

  it('does NOT parse random JSON without a tool name', () => {
    const input = '{"path":"radix_sort.c","content":"test"}';
    const calls = ToolParser.parse(input);
    assert.strictEqual(0, calls.length);
  });

  it('parses write_file JSON with multiline escaped content', () => {
    const input = 'write_file\n{"path":"multi.c","content":"line1\\nline2\\nline3\\n"}';
    const calls = ToolParser.parse(input);
    assert.strictEqual(1, calls.length);
    assert.strictEqual('write_file', calls[0].tool);
    assert.strictEqual('multi.c', calls[0].params.path);
    assert.ok(calls[0].params.content.includes('line2'));
  });

  it('prefers XML format over JSON when both present', () => {
    const input = '<tool>read_file</tool>\n<params>{"path": "from_xml.txt"}</params>\nwrite_file\n{"path":"from_json.txt","content":"should not reach"}';
    const calls = ToolParser.parse(input);
    // XML should be returned first, JSON ignored because XML matched
    assert.strictEqual(1, calls.length);
    assert.strictEqual('read_file', calls[0].tool);
  });

  it('handles JSON content with C code that has #include', () => {
    const input = 'write_file\n{"path":"test.c","content":"#include <stdio.h>\\nint main() {\\n    printf(\\"hello\\");\\n    return 0;\\n}"}';
    const calls = ToolParser.parse(input);
    assert.strictEqual(1, calls.length);
    assert.strictEqual('write_file', calls[0].tool);
    assert.strictEqual('test.c', calls[0].params.path);
  });

  it('returns empty for text with code blocks but not tool calls', () => {
    const input = 'Here is the C code:\n```c\n#include <stdio.h>\nint main() {}\n```\nFile: main.c';
    const calls = ToolParser.parse(input);
    assert.strictEqual(0, calls.length);
  });

  it('parses write_file with very long content field', () => {
    const code = [];
    for (let i = 0; i < 20; i++) code.push('printf("line ' + i + '\\n");');
    const content = code.join('\\n    ');
    const input = 'write_file\n{"path":"long.c","content":"' + content.replace(/"/g, '\\"') + '"}';
    const calls = ToolParser.parse(input);
    assert.strictEqual(1, calls.length);
    assert.strictEqual('write_file', calls[0].tool);
    assert.strictEqual('long.c', calls[0].params.path);
    assert.ok(calls[0].params.content.length > 100);
  });

  it('parses list_dir with JSON format', () => {
    const input = 'list_dir\n{"path":"."}';
    const calls = ToolParser.parse(input);
    assert.strictEqual(1, calls.length);
    assert.strictEqual('list_dir', calls[0].tool);
    assert.strictEqual('.', calls[0].params.path);
  });

  it('handles tool name with trailing spaces before JSON', () => {
    const input = 'write_file   \n{"path":"test.txt","content":"hello"}';
    const calls = ToolParser.parse(input);
    assert.strictEqual(1, calls.length);
    assert.strictEqual('write_file', calls[0].tool);
  });
});
