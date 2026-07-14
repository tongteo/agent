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

  // --- HTML content flow cases (tags + braces stress parser) ---
  it('parses write_file XML with full HTML document (tags inside params)', () => {
    const html = '<!DOCTYPE html><html><head><title>8 Queens</title><style>body{margin:0}</style></head><body><div id="board"></div><script>const N=8;function solve(){return [];}</script></body></html>';
    const input = `<tool>write_file</tool>\n<params>${JSON.stringify({ path: '~/test/8queens.html', content: html })}</params>`;
    const calls = ToolParser.parse(input);
    assert.strictEqual(1, calls.length);
    assert.strictEqual('write_file', calls[0].tool);
    assert.strictEqual('~/test/8queens.html', calls[0].params.path);
    assert.ok(calls[0].params.content.includes('<!DOCTYPE html>'));
    assert.ok(calls[0].params.content.includes('<div id="board"></div>'));
    assert.ok(calls[0].params.content.includes('</html>'));
    assert.ok(calls[0].params.content.includes('body{margin:0}'));
  });

  it('parses write_file JSON format with HTML containing braces in CSS/JS', () => {
    const html = '<html><style>.cell{width:40px;height:40px}</style><script>function f(){return {n:8};}</script></html>';
    const input = 'write_file\n' + JSON.stringify({ path: 'board.html', content: html });
    const calls = ToolParser.parse(input);
    assert.strictEqual(1, calls.length, 'JSON format must keep full HTML with braces');
    assert.strictEqual('write_file', calls[0].tool);
    assert.strictEqual('board.html', calls[0].params.path);
    assert.strictEqual(html, calls[0].params.content);
  });

  it('parses write_file XML HTML with nested angle brackets and script braces', () => {
    const html = [
      '<!DOCTYPE html>',
      '<html lang="en">',
      '<head><meta charset="UTF-8"><title>Queens</title>',
      '<style>',
      '  .board { display: grid; grid-template-columns: repeat(8, 1fr); }',
      '  .q { content: "♛"; }',
      '</style></head>',
      '<body><h1>8 Queens</h1><div id="app"></div>',
      '<script>',
      '  const board = [];',
      '  function isSafe(r, c) { return true; }',
      '  function solve(row) { if (row === 8) { return; } }',
      '  document.getElementById("app").innerHTML = "<p>ok</p>";',
      '</script></body></html>'
    ].join('\n');
    const input = `<tool>write_file</tool>\n<params>${JSON.stringify({ path: '/root/test/8queens.html', content: html })}</params>`;
    const calls = ToolParser.parse(input);
    assert.strictEqual(1, calls.length);
    assert.strictEqual(html, calls[0].params.content);
    assert.ok(calls[0].params.content.includes('grid-template-columns'));
    assert.ok(calls[0].params.content.includes('</script></body></html>'));
  });

  it('does not truncate HTML content when CSS rules contain closing braces', () => {
    // Classic _extractJsonBraces bug: "}" inside string ends object early
    const html = '<style>body { margin: 0 } .x { color: red }</style><div>after braces</div>';
    const input = 'write_file\n' + JSON.stringify({ path: 'a.html', content: html });
    const calls = ToolParser.parse(input);
    assert.strictEqual(1, calls.length);
    assert.ok(
      calls[0].params.content.includes('after braces'),
      'content truncated at CSS }; got: ' + JSON.stringify(calls[0]?.params?.content)
    );
    assert.strictEqual(html, calls[0].params.content);
  });
});
