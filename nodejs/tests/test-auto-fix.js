/**
 * @fileoverview Tests for auto-fix C compilation utility.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { autoFixCFile } = require('../src/core/auto-fix');

const TMP = os.tmpdir();

describe('autoFixCFile', () => {
  it('returns empty for non-existent file', () => {
    const result = autoFixCFile('/nonexistent/path.c', '');
    assert.strictEqual(result, '');
  });

  it('returns empty for empty file', () => {
    const f = path.join(TMP, 'empty-' + Date.now() + '.c');
    fs.writeFileSync(f, '   ');
    const result = autoFixCFile(f, '');
    assert.strictEqual(result, '');
    fs.unlinkSync(f);
  });

  it('fixes missing closing brace', () => {
    const f = path.join(TMP, 'nobraces-' + Date.now() + '.c');
    fs.writeFileSync(f, 'int main() {\n  printf("hi");\n');
    const result = autoFixCFile(f, '');
    assert.ok(result.includes('missing closing brace'));
    const content = fs.readFileSync(f, 'utf-8');
    assert.ok(content.includes('}'));
    assert.strictEqual((content.match(/\}/g) || []).length, 1);
    fs.unlinkSync(f);
  });

  it('fixes return statement with missing semicolon', () => {
    const f = path.join(TMP, 'returnsemi-' + Date.now() + '.c');
    fs.writeFileSync(f, 'int x = 42');
    const result = autoFixCFile(f, '');
    assert.ok(result.includes('semicolon'));
    const content = fs.readFileSync(f, 'utf-8');
    assert.ok(content.endsWith(';'));
    fs.unlinkSync(f);
  });

  it('fixes unclosed printf parentheses', () => {
    const f = path.join(TMP, 'printfix-' + Date.now() + '.c');
    fs.writeFileSync(f, '#include <stdio.h>\nint main() {\n  printf("hello %d", 42\n  return 0;\n}');
    const result = autoFixCFile(f, '');
    assert.ok(result);
    const content = fs.readFileSync(f, 'utf-8');
    // Check parentheses are balanced
    assert.strictEqual((content.match(/\(/g) || []).length, (content.match(/\)/g) || []).length);
    fs.unlinkSync(f);
  });

  it('returns empty for no errors in file', () => {
    const f = path.join(TMP, 'good-' + Date.now() + '.c');
    fs.writeFileSync(f, 'int main() { return 0; }');
    const result = autoFixCFile(f, '');
    assert.strictEqual(result, '');
    fs.unlinkSync(f);
  });

  it('handles read errors gracefully', () => {
    // Pass a directory path which would fail to read as file
    const result = autoFixCFile('/tmp', '');
    assert.strictEqual(result, '');
  });
});
