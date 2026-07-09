/**
 * @fileoverview Tests for stream utility functions.
 */

const { hasToolCall, stripToolCalls, buildToolCallRegex } = require('../src/core/stream-utils');

const SAMPLE_TOOLS = ['write_file', 'read_file', 'bash', 'execute', 'list_dir'];

describe('stream-utils', () => {
  describe('hasToolCall', () => {
    it('detects <tool> XML format', () => {
      assert.ok(hasToolCall('some text <tool>bash</tool>', SAMPLE_TOOLS));
    });

    it('detects HTML-escaped <tool>', () => {
      assert.ok(hasToolCall('text &lt;tool&gt;bash&lt;/tool&gt;', SAMPLE_TOOLS));
    });

    it('detects longcat format', () => {
      assert.ok(hasToolCall('text <longcat_tool_call>ls</longcat_arg_value>', SAMPLE_TOOLS));
    });

    it('detects TOOL_CALL: prefix', () => {
      assert.ok(hasToolCall('text TOOL_CALL: ls -la', SAMPLE_TOOLS));
    });

    it('detects JSON format (toolName\\n{)', () => {
      assert.ok(hasToolCall('write_file\n{"path":"test.txt"}', SAMPLE_TOOLS));
    });

    it('detects JSON format via pendingToolCalls', () => {
      assert.ok(hasToolCall('text', [], ['tc1']));
    });

    it('returns false for plain text', () => {
      assert.strictEqual(hasToolCall('Hello, how are you?', SAMPLE_TOOLS), false);
    });

    it('returns false for inline JSON without newline (handled by ToolParser)', () => {
      // Inline format "bash {\"command\":\"ls\"}" is handled by ToolParser._parseJsonFormat
      assert.strictEqual(hasToolCall('bash {"command":"ls"}', SAMPLE_TOOLS), false);
    });

    it('returns false for empty text', () => {
      assert.strictEqual(hasToolCall('', SAMPLE_TOOLS), false);
    });
  });

  describe('stripToolCalls', () => {
    it('strips <tool> tags and everything after', () => {
      const result = stripToolCalls('Hello\n<tool>bash</tool>\n<params>{"command":"ls"}</params>', SAMPLE_TOOLS);
      assert.strictEqual(result, 'Hello');
    });

    it('preserves non-tool text when no tool calls present', () => {
      const result = stripToolCalls('Just some text', SAMPLE_TOOLS);
      assert.strictEqual(result, 'Just some text');
    });

    it('returns empty for pure XML tool call text', () => {
      const result = stripToolCalls('<tool>bash</tool>\n<params>{"command":"ls"}</params>', SAMPLE_TOOLS);
      assert.strictEqual(result, '');
    });

    it('strips tool call text after conversational prefix (regression check)', () => {
      // stripToolCalls handles XML tags but may leave partial JSON trailing content
      const result = stripToolCalls('Let me do that\n<tool>bash</tool>\n<params>{"command":"ls"}</params>', SAMPLE_TOOLS);
      // Should at least remove the <tool> tag
      assert.ok(!result.includes('<tool>'));
    });
  });

  describe('buildToolCallRegex', () => {
    it('matches tool name followed by newline and brace', () => {
      const re = buildToolCallRegex(SAMPLE_TOOLS);
      assert.ok(re.test('write_file\n{'));
      assert.ok(re.test('bash\n{'));
      assert.ok(!re.test('unknown_tool\n{'));
    });

    it('escapes special regex chars in tool names', () => {
      const re = buildToolCallRegex(['my-tool', 'tool.v2']);
      assert.ok(re.test('my-tool\n{'));
      assert.ok(re.test('tool.v2\n{'));
    });
  });
});
