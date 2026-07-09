/**
 * @fileoverview Tests for CommandExecutor — shell command execution with session context.
 */

const path = require('path');
const os = require('os');
const fs = require('fs');
const { SessionManager } = require('../src/core/session');
const { CommandExecutor } = require('../src/commands/executor');

const TEST_SESSION = path.join(os.tmpdir(), 'test-exec-session-' + Date.now() + '.json');

describe('CommandExecutor', () => {
  // Set up per-test by creating session & executor fresh
  function makeExecutor() {
    try { fs.unlinkSync(TEST_SESSION); } catch {}
    const session = new SessionManager(TEST_SESSION);
    const executor = new CommandExecutor(session);
    return { session, executor };
  }

  it('getShell() returns bash on Linux', () => {
    const { executor } = makeExecutor();
    if (process.platform !== 'win32') {
      assert.ok(executor.getShell().includes('bash'));
    }
  });

  it('execute() runs simple command and returns output', () => {
    const { executor } = makeExecutor();
    const output = executor.execute('echo "hello world"');
    assert.ok(output.includes('hello world'));
  });

  it('execute() returns output for command with no stdout', () => {
    const { executor, session } = makeExecutor();
    const output = executor.execute('cd /tmp');
    assert.ok(output);
    assert.strictEqual(session.workingDir, '/tmp');
  });

  it('execute() handles cd command', () => {
    const { executor, session } = makeExecutor();
    const prevDir = session.workingDir;
    executor.execute('cd /tmp');
    assert.strictEqual(session.workingDir, '/tmp');
    executor.execute(`cd ${prevDir}`);
  });

  it('execute() handles export command', () => {
    const { executor, session } = makeExecutor();
    executor.execute('export MY_TEST_VAR=hello123');
    assert.strictEqual(session.envVars.MY_TEST_VAR, 'hello123');
  });

  it('execute() handles cd with ~ expansion', () => {
    const { executor, session } = makeExecutor();
    const home = os.homedir();
    executor.execute('cd ~');
    assert.strictEqual(session.workingDir, home);
  });

  it('execute() shows error for invalid command', () => {
    const { executor } = makeExecutor();
    const output = executor.execute('some_command_that_does_not_exist_xyz');
    assert.ok(output.includes('Error') || output.includes('not found'));
  });

  it('handleCd resolves relative paths', () => {
    const { executor, session } = makeExecutor();
    const result = executor.handleCd('/tmp');
    assert.ok(result.includes('/tmp'));
    assert.strictEqual(session.workingDir, '/tmp');
  });

  it('handleCd returns error for nonexistent directory', () => {
    const { executor } = makeExecutor();
    const result = executor.handleCd('/tmp/__nonexistent_dir_xyz__');
    assert.ok(result.includes('Error'));
  });

  it('handleExport strips surrounding quotes', () => {
    const { executor, session } = makeExecutor();
    const result = executor.handleExport('MY_VAR', "'quoted_value'");
    assert.strictEqual(session.envVars.MY_VAR, 'quoted_value');
    assert.ok(result.includes('MY_VAR=quoted_value'));
  });

  it('handleExport stores value to session', () => {
    const { executor, session } = makeExecutor();
    executor.handleExport('MY_KEY', 'myval');
    assert.strictEqual(session.envVars.MY_KEY, 'myval');
  });
});
