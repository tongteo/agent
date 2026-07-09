/**
 * @fileoverview Tests for ContextManager — token estimation and history trimming.
 */

const { ContextManager } = require('../src/core/context-manager');

describe('ContextManager', () => {
  const cm = new ContextManager({ maxTokens: 32000 });

  it('estimateTokens returns 0 for empty/null', () => {
    assert.strictEqual(cm.estimateTokens(null), 0);
    assert.strictEqual(cm.estimateTokens(''), 0);
    assert.strictEqual(cm.estimateTokens(undefined), 0);
  });

  it('estimateTokens counts ASCII text (approx 4 chars/token)', () => {
    const tokens = cm.estimateTokens('hello world how are you doing today');
    // 34 chars / 4 = 8.5 → 9
    assert.strictEqual(tokens, 9);
  });

  it('estimateTokens counts CJK characters with higher weight', () => {
    const tokens = cm.estimateTokens('你好世界');
    // 4 CJK chars * 1.5 = 6
    assert.strictEqual(tokens, 6);
  });

  it('countMessages returns 0 for empty array', () => {
    assert.strictEqual(cm.countMessages([]), 0);
    assert.strictEqual(cm.countMessages(null), 0);
  });

  it('countMessages includes per-message overhead (4 tokens)', () => {
    const msgs = [{ role: 'user', content: 'hello' }];
    const total = cm.countMessages(msgs);
    // 5 chars / 4 = 2, + 4 overhead = 6
    assert.strictEqual(total, 6);
  });

  it('trimHistory returns unchanged when under threshold', () => {
    const msgs = [
      { role: 'system', content: 'You are a helpful assistant.' },
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi there!' }
    ];
    const result = cm.trimHistory(msgs);
    assert.strictEqual(result.trimmed, false);
    assert.strictEqual(result.messages.length, 3);
  });

  it('trimHistory preserves system message when trimming', () => {
    const msgs = [{ role: 'system', content: 'System prompt here.' }];
    for (let i = 0; i < 200; i++) {
      msgs.push({ role: 'user', content: 'A'.repeat(500) });
      msgs.push({ role: 'assistant', content: 'B'.repeat(1000) });
    }

    const result = cm.trimHistory(msgs);
    assert.strictEqual(true, result.trimmed);
    assert.ok(result.messages.length < msgs.length);
    assert.strictEqual('system', result.messages[0].role);
  });

  it('trimHistory on small message arrays returns unchanged', () => {
    const msgs = [{ role: 'user', content: 'hi' }];
    const result = cm.trimHistory(msgs);
    assert.strictEqual(false, result.trimmed);
    assert.strictEqual(1, result.messages.length);
  });

  it('truncate shortens long text to fit budget', () => {
    const long = 'A'.repeat(10000);
    const truncated = cm.truncate(long, 100);
    assert.ok(truncated.length < long.length);
    assert.ok(truncated.includes('(truncated,'));
  });

  it('truncate returns unchanged text when within budget', () => {
    const text = 'Short text';
    assert.strictEqual(cm.truncate(text, 1000), text);
  });

  it('truncate handles null/undefined', () => {
    assert.strictEqual(cm.truncate(null), null);
    assert.strictEqual(cm.truncate(undefined), undefined);
  });

  it('getStats returns formatted string', () => {
    const msgs = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'hello' }
    ];
    const stats = cm.getStats(msgs);
    assert.ok(stats.includes('Context:'));
    assert.ok(stats.includes('tokens'));
  });

  it('supports custom maxTokens and thresholds', () => {
    const small = new ContextManager({ maxTokens: 100, warningThreshold: 0.5, trimTarget: 0.3 });
    const msgs = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'A'.repeat(200) },
      { role: 'assistant', content: 'B'.repeat(200) }
    ];
    const result = small.trimHistory(msgs);
    assert.strictEqual(true, result.trimmed);
  });
});
