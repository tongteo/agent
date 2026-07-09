/**
 * @fileoverview Tests for SessionManager — session persistence and env vars.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { SessionManager } = require('../src/core/session');

const TEST_SESSION = path.join(os.tmpdir(), 'test-session-' + Date.now() + '.json');

describe('SessionManager', () => {
  function freshSM() {
    try { fs.unlinkSync(TEST_SESSION); } catch {}
    return new SessionManager(TEST_SESSION);
  }

  it('initializes with defaults', () => {
    const sm = freshSM();
    assert.strictEqual(sm.workingDir, process.cwd());
    assert.strictEqual(sm.allowAll, false);
    assert.ok(sm.envVars.PATH);
  });

  it('save() writes to file', () => {
    const sm = freshSM();
    sm.workingDir = '/tmp';
    sm.save(['msg1']);
    const content = fs.readFileSync(TEST_SESSION, 'utf-8');
    const data = JSON.parse(content);
    assert.strictEqual(data.workingDir, '/tmp');
    assert.deepStrictEqual(data.messages, ['msg1']);
  });

  it('load() returns saved messages', () => {
    const sm = freshSM();
    sm.workingDir = '/home/test';
    sm.save(['hello', 'world']);
    const msgs = sm.load();
    assert.deepStrictEqual(msgs, ['hello', 'world']);
  });

  it('load() returns empty array on missing file', () => {
    const sm = freshSM();
    try { fs.unlinkSync(TEST_SESSION); } catch {}
    const msgs = sm.load();
    assert.deepStrictEqual(msgs, []);
  });

  it('reset() restores defaults', () => {
    const sm = freshSM();
    sm.workingDir = '/tmp';
    sm.envVars.CUSTOM = 'value';
    sm.allowAll = true;
    sm.reset();
    assert.strictEqual(sm.workingDir, process.cwd());
    assert.strictEqual(sm.allowAll, false);
    assert.strictEqual(sm.envVars.CUSTOM, undefined);
  });

  it('save() silences write errors', () => {
    const badSm = new SessionManager('/nonexistent/deep/dir/file.json');
    badSm.save(['test']);
    assert.ok(true);
  });

  it('load() returns empty on corrupted file', () => {
    const sm = freshSM();
    fs.writeFileSync(TEST_SESSION, 'not-json');
    const msgs = sm.load();
    assert.deepStrictEqual(msgs, []);
  });
});
