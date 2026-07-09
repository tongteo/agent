/**
 * @fileoverview Tests for browser-manager — CDP connection and Chromium lifecycle.
 */

const { getBrowser, releaseBrowser, closeBrowser } = require('../src/bridges/browser-manager');

describe('browser-manager', () => {
  it('exports expected API', () => {
    assert.strictEqual(typeof getBrowser, 'function');
    assert.strictEqual(typeof releaseBrowser, 'function');
    assert.strictEqual(typeof closeBrowser, 'function');
  });
});

describe('getBrowser', () => {
  it('connects to CDP and returns a connected browser', async () => {
    const browser = await getBrowser();
    assert.ok(browser, 'browser instance should be truthy');
    assert.strictEqual(browser.connected, true, 'browser should be connected');
    releaseBrowser();
  });

  it('returns same instance on concurrent calls (reference counting)', async () => {
    const a = await getBrowser();
    const b = await getBrowser();
    assert.strictEqual(a, b, 'should return the same Browser object');
    releaseBrowser();
    releaseBrowser();
  });

  it('works after close (re-connect)', async () => {
    // Drain any prior refs
    const a = await getBrowser();
    releaseBrowser();
    await closeBrowser();

    const b = await getBrowser();
    assert.ok(b.connected, 're-connected browser should be connected');
    assert.strictEqual(b.connected, true);
    releaseBrowser();
  });

  it('closeBrowser disconnects cleanly', async () => {
    const a = await getBrowser();
    assert.ok(a.connected);
    releaseBrowser();
    await closeBrowser();

    // Reconnect after close should work without error
    let error = null;
    try {
      const b = await getBrowser();
      assert.ok(b.connected);
      releaseBrowser();
    } catch (e) {
      error = e;
    }
    assert.strictEqual(error, null, 'should not throw after close/reconnect');
  });
});
