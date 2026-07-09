/**
 * @fileoverview Browser connection manager — shared CDP/Playwright connection pool.
 * Connects to existing Chromium debug port or launches headed Chromium under Xvfb as fallback.
 *
 * On ARM64 / headless systems (e.g. PRoot/Termux), Chromium 149+ new headless mode
 * requires a GPU that isn't available. This module runs Chromium in headed mode under
 * Xvfb (virtual framebuffer) as a workaround.
 */

const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

/** @type {string} Browser CDP URL from environment or default */
const BROWSER_URL = process.env.PLAYWRIGHT_BROWSER_URL || process.env.CDP_URL || 'http://localhost:9222';

/** @type {string|undefined} Auto-detected Chromium executable path */
const CHROMIUM_PATH = (() => {
  if (process.env.PLAYWRIGHT_CHROMIUM_PATH) return process.env.PLAYWRIGHT_CHROMIUM_PATH;
  const home = process.env.HOME || '/root';
  const candidates = [];

  // 1. Playwright-managed Chromium (ARM-native on this system)
  try {
    const dirs = fs.readdirSync(path.join(home, '.cache/ms-playwright'))
      .filter(d => d.startsWith('chromium-') && !d.includes('headless')).sort().reverse();
    for (const d of dirs) {
      candidates.push(path.join(home, '.cache/ms-playwright', d, 'chrome-linux/chrome'));
    }
  } catch {}

  // 2. Puppeteer's bundled Chromium (may be x86-64 on ARM — filter by arch)
  const arch = process.arch; // 'arm64' on this system
  try {
    const dir = fs.readdirSync(path.join(home, '.cache/puppeteer')).filter(d => d === 'chrome');
    for (const d of dir) {
      const versions = fs.readdirSync(path.join(home, '.cache/puppeteer', d)).sort().reverse();
      for (const v of versions) {
        const p = path.join(home, '.cache/puppeteer', d, v, 'chrome-linux64', 'chrome');
        // Skip if architecture mismatch (e.g. x86-64 on arm64)
        if (arch === 'arm64' && v.includes('linux_arm')) continue;
        if (fs.existsSync(p)) candidates.push(p);
      }
    }
  } catch {}

  // 3. Common system paths
  for (const p of ['/usr/bin/chromium','/usr/bin/chromium-browser','/usr/bin/google-chrome','/usr/bin/google-chrome-stable','/snap/bin/chromium']) {
    if (fs.existsSync(p)) return p;
  }

  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return undefined;
})();

/** @type {import('puppeteer-core').Browser|null} */
let _browser = null;
/** @type {number} */
let _refCount = 0;

/**
 * Check if a puppeteer error is a connection/transport failure (recoverable).
 * @param {Error} err
 * @returns {boolean}
 */
function isConnectionError(err) {
  const msg = err?.message || '';
  return msg.includes('Connection closed') ||
    msg.includes('Session closed') ||
    msg.includes('Target closed') ||
    msg.includes('detached Frame') ||
    msg.includes('Protocol error') ||
    msg.includes('Requesting main frame too early');
}

/**
 * Ensure Xvfb is running so Chromium can start in headed mode.
 * Sets DISPLAY env if not already set. On platforms where Xvfb isn't
 * available (macOS, Windows, or full Linux desktop), this is a no-op.
 * @returns {boolean} true if a display is available
 */
function ensureDisplay() {
  if (process.env.DISPLAY) return true;

  const xvfbPid = (() => {
    try {
      const out = execSync('pgrep -x Xvfb', { encoding: 'utf8', timeout: 3000 }).trim();
      return out ? parseInt(out, 10) : null;
    } catch { return null; }
  })();

  if (xvfbPid) {
    process.env.DISPLAY = ':99';
    return true;
  }

  // Try to start Xvfb ourselves
  try {
    execSync('which Xvfb', { encoding: 'utf8', timeout: 3000 });
    // Xvfb is available — start it
    execSync('Xvfb :99 -screen 0 1280x720x24 -ac 2>/dev/null &', { encoding: 'utf8', timeout: 5000 });
    // Wait for the socket to appear
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      if (fs.existsSync('/tmp/.X11-unix/X99')) break;
      execSync('sleep 0.2', { encoding: 'utf8', timeout: 1000 });
    }
    process.env.DISPLAY = ':99';
    return true;
  } catch {
    console.error('[browser-manager] Xvfb not available. Install it or set DISPLAY.');
    return false;
  }
}

/**
 * Get or create a shared browser instance.
 * Tries connecting to existing CDP endpoint first, then falls back to launching
 * our own Chromium. Automatically reconnects if the connection is lost.
 * @returns {Promise<import('puppeteer-core').Browser>} Browser instance
 */
async function getBrowser() {
  if (_browser && _browser.connected) {
    _refCount++;
    return _browser;
  }

  // Invalidate stale browser
  _browser = null;

  // Try existing CDP endpoint first (local Chromium managed by Hermes/CDP supervisor)
  try {
    _browser = await puppeteer.connect({ browserURL: BROWSER_URL, defaultViewport: null });
    _refCount = 1;
    return _browser;
  } catch { /* fall through to launch */ }

  // Launch our own managed Chromium instance (headed, under Xvfb)
  if (!CHROMIUM_PATH) {
    throw new Error(
      'No Chromium executable found. Install Chromium or set PLAYWRIGHT_CHROMIUM_PATH.\n' +
      '  npm install puppeteer  (bundles Chromium)\n' +
      '  or: apt install chromium-browser\n' +
      '  or: export PLAYWRIGHT_CHROMIUM_PATH=/path/to/chrome'
    );
  }

  if (!ensureDisplay()) {
    throw new Error(
      'No display available for Chromium. Install Xvfb or set DISPLAY.\n' +
      '  apt install xvfb\n' +
      '  or: export DISPLAY=:0'
    );
  }

  _browser = await puppeteer.launch({
    headless: false,
    executablePath: CHROMIUM_PATH,
    defaultViewport: { width: 1280, height: 720 },
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--in-process-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-blink-features=AutomationControlled',
      '--window-size=1280,720'
    ]
  });
  _refCount = 1;
  return _browser;
}

/**
 * Call a browser method with automatic retry on connection loss.
 * Handles the case where external CDP supervisors (Hermes, etc.) close
 * the connection mid-operation.
 * @template T
 * @param {string} label - Operation label for error messages
 * @param {() => Promise<T>} fn - Operation to perform
 * @param {number} [retries=2] - Max retries
 * @returns {Promise<T>}
 */
async function withRetry(label, fn, retries = 2) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (isConnectionError(err) && attempt < retries) {
        // Connection dropped — reconnect and retry
        if (_browser) {
          try { _browser.disconnect(); } catch { /* ignore */ }
          _browser = null;
          _refCount = 0;
        }
        await getBrowser(); // reconnect
        continue;
      }
      throw err;
    }
  }
}

/**
 * Release a reference to the shared browser instance.
 * Disconnects when all references are released.
 */
function releaseBrowser() {
  _refCount--;
  if (_refCount <= 0 && _browser) {
    try { _browser.disconnect(); } catch {}
    _browser = null;
    _refCount = 0;
  }
}

/**
 * Force-close the shared browser instance.
 */
async function closeBrowser() {
  if (_browser) {
    try { await _browser.close(); } catch {}
    _browser = null;
    _refCount = 0;
  }
}

module.exports = { getBrowser, releaseBrowser, closeBrowser, withRetry };
