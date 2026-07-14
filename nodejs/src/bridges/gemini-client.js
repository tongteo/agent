/**
 * @fileoverview Gemini web client — drives Gemini AI through Playwright (CDP).
 * Sends messages and retrieves responses by interacting with the Gemini web UI.
 */

const { getBrowser, releaseBrowser, withRetry } = require('./browser-manager');
const fs = require('fs');
const path = require('path');

/** @type {string} Gemini web app URL */
const GEMINI_URL = 'https://gemini.google.com/app';

/** @type {string|null} Cached cookies path */
const COOKIES_PATH = path.join(__dirname, '../../gemini_cookies.json');

class GeminiClient {
  constructor() {
    /** @type {import('puppeteer-core').Page|null} */
    this._page = null;
    /** @type {string|null} Raw response captured from fetch interception */
    this._capturedRaw = null;
  }

  /**
   * Initialize: reuse an existing page or create one, then navigate to Gemini.
   * @returns {Promise<void>}
   */
  async init() {
    const browser = await getBrowser();
    await this._ensurePage(browser);
    // Patch XHR in current page (in case page already loaded)
    await this._page.evaluate(() => {
      if (window.__gRawPatched) return;
      window.__gRawPatched = true;
      window.__geminiRaw = null;
      const origOpen = XMLHttpRequest.prototype.open;
      const origSend = XMLHttpRequest.prototype.send;
      XMLHttpRequest.prototype.open = function(method, url) {
        this._gUrl = typeof url === 'string' ? url : (url || '');
        return origOpen.apply(this, arguments);
      };
      XMLHttpRequest.prototype.send = function(body) {
        const url = this._gUrl || '';
        if (url.includes('StreamGenerate') || url.includes('assistant.lamda.BardFrontendService')) {
          this.addEventListener('readystatechange', () => {
            if (this.readyState >= 3) {
              try {
                const txt = this.responseText;
                if (txt && txt.length > 100) window.__geminiRaw = txt;
              } catch {}
            }
          });
        }
        return origSend.apply(this, arguments);
      };
    });
    // Also inject for future navigations (e.g. Gemini page reload)
    await this._page.evaluateOnNewDocument(() => {
      if (window.__gRawPatched) return;
      window.__gRawPatched = true;
      window.__geminiRaw = null;
      const origOpen = XMLHttpRequest.prototype.open;
      const origSend = XMLHttpRequest.prototype.send;
      XMLHttpRequest.prototype.open = function(method, url) {
        this._gUrl = typeof url === 'string' ? url : (url || '');
        return origOpen.apply(this, arguments);
      };
      XMLHttpRequest.prototype.send = function(body) {
        const url = this._gUrl || '';
        if (url.includes('StreamGenerate') || url.includes('assistant.lamda.BardFrontendService')) {
          this.addEventListener('readystatechange', () => {
            if (this.readyState >= 3) {
              try {
                const txt = this.responseText;
                if (txt && txt.length > 100) window.__geminiRaw = txt;
              } catch {}
            }
          });
        }
        return origSend.apply(this, arguments);
      };
    });
    await this._injectCookies(this._page);
    await this._navigate(this._page, GEMINI_URL);
    // If authenticated, Gemini shows the chat input directly; otherwise redirects to
    // accounts.google.com. Check for the input field with a shorter timeout first.
    try {
      await this._page.waitForSelector('[contenteditable="true"]', { timeout: 10000 });
    } catch {
      // Not authenticated via cookies — navigate again to trigger the challenge
      console.error('  ✗ Gemini cookies expired or invalid. Re-login required.');
      throw new Error('Gemini cookie login failed');
    }
  }

  /**
   * Load cookies from gemini_cookies.json and set them on the page.
   * @param {import('puppeteer-core').Page} page
   * @returns {Promise<void>}
   * @private
   */
  async _injectCookies(page) {
    let raw;
    try {
      raw = fs.readFileSync(COOKIES_PATH, 'utf8');
    } catch {
      console.error('  ✗ gemini_cookies.json not found at ' + COOKIES_PATH);
      throw new Error('Missing gemini_cookies.json');
    }

    // Lock down cookie file permissions (contains auth tokens)
    try { fs.chmodSync(COOKIES_PATH, 0o600); } catch { /* best-effort */ }

    /** @type {Array<{domain: string, name: string, value: string, secure?: boolean, httpOnly?: boolean, path?: string, sameSite?: string}>} */
    let cookies;
    try {
      cookies = JSON.parse(raw);
    } catch {
      throw new Error('Invalid gemini_cookies.json: not valid JSON');
    }

    // Normalise: __Secure-* cookies MUST have secure=true for Chrome to accept them
    for (const c of cookies) {
      if (c.name && c.name.startsWith('__Secure-')) {
        c.secure = true;
      }
      // Ensure domain doesn't start with a dot — puppeteer doesn't need it
      if (c.domain && c.domain.startsWith('.')) {
        c.domain = c.domain.substring(1);
      }
      // Puppeteer cookie format
      if (typeof c.httpOnly !== 'boolean') c.httpOnly = false;
      if (typeof c.secure !== 'boolean') c.secure = true;
      if (c.sameSite === 'unspecified' || !c.sameSite) c.sameSite = 'Lax';
      if (!c.path) c.path = '/';
    }

    // Filter out cookies whose value starts with placeholder
    const validCookies = cookies.filter(c => c.value && !c.value.startsWith('YOUR_'));
    if (validCookies.length === 0) {
      throw new Error('All cookies in gemini_cookies.json are placeholders. Export real cookies from a logged-in browser.');
    }

    await page.setCookie(...validCookies);
    console.log(`  ✓ Loaded ${validCookies.length} cookies from gemini_cookies.json`);
  }

  /**
   * Get a usable page from the shared browser.
   * Prefers reusing an existing page (already has frame tree initialized)
   * over creating a new one.
   * @param {import('puppeteer-core').Browser} browser
   * @returns {Promise<void>}
   * @private
   */
  async _ensurePage(browser) {
    this._page = await withRetry('ensurePage', async () => {
      // Reuse existing page if available — avoids frame tree race on CDP connect
      const existing = await browser.pages();
      for (const p of existing) {
        try {
          // Verify the page is usable with a quick ping
          await p.evaluate(() => document.readyState);
          return p;
        } catch {
          // Page is stale — close it and move on
          try { await p.close(); } catch { /* ignore */ }
        }
      }

      // No usable existing page — create a new one
      return await browser.newPage();
    });
  }

  /**
   * Navigate to a URL, resilient to frame tree initialization delays.
   * Uses DOMContentLoaded instead of networkidle0 because Gemini's SPA
   * maintains persistent SSE connections that never satisfy "network idle".
   * @param {import('puppeteer-core').Page} page
   * @param {string} url
   * @returns {Promise<void>}
   * @private
   */
  async _navigate(page, url) {
    try {
      await withRetry('goto', () => page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 }));
      // Give SPA time to bootstrap
      await new Promise(r => setTimeout(r, 3000));
      return;
    } catch (err) {
      // Only handle known recoverable errors
      if (!err.message.includes('main frame too early') &&
          !err.message.includes('detached Frame') &&
          !err.message.includes('Session closed') &&
          !err.message.includes('Connection closed')) {
        throw err;
      }
    }

    // Navigate via CDP with DOMContentReady (not networkIdle — SSE never idles)
    try {
      const cdp = await page.createCDPSession();
      await cdp.send('Page.enable');
      const navigationPromise = new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('CDP navigate timeout')), 35000);
        cdp.on('Page.lifecycleEvent', event => {
          if (event.name === 'DOMContentLoaded') {
            clearTimeout(timeout);
            resolve();
          }
        });
      });
      await cdp.send('Page.navigate', { url });
      await navigationPromise;
      await new Promise(r => setTimeout(r, 3000));
    } catch (cdpErr) {
      throw new Error(
        `Failed to navigate to Gemini. Page frame not ready and CDP fallback failed.\n` +
        `Please restart or check that the browser at localhost:9222 is alive.\n` +
        `(${cdpErr.message})`
      );
    }
  }

  /**
   * Wait for input area to become ready, with timeout and auto-cancellation.
   * If the page is stuck, force-navigates to a fresh Gemini session as recovery.
   * @param {number} [timeoutMs=25000] - Max wait in ms before force navigation
   * @param {number} [recoveryAttempt=0] - Internal: number of recovery attempts
   * @returns {Promise<void>}
   * @private
   */
  async _waitForInputReady(timeoutMs = 25000, recoveryAttempt = 0) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const ready = await this._page.evaluate(() => {
        const stopBtn = document.querySelector(
          '[aria-label*="Ngừng"], [aria-label*="Stop generating"]'
        );
        return { busy: stopBtn ? (stopBtn.offsetParent !== null) : false };
      });
      if (!ready.busy) {
        // Small extra wait for Angular to settle after stop button disappears
        await new Promise(r => setTimeout(r, 1000));
        return;
      }
      // Force-click stop at 10s remaining
      if (Date.now() + 10000 > deadline) {
        await this._page.evaluate(() => {
          const btn = document.querySelector(
            '[aria-label*="Ngừng"], [aria-label*="Stop generating"]'
          );
          if (btn) btn.click();
        });
      }
      await new Promise(r => setTimeout(r, 500));
    }

    // Recovery: reload page (preserves current Gemini conversation session)
    if (recoveryAttempt < 1) {
      process.stderr.write('\r\x1b[K  \u21bb reloading Gemini page...\n');
      try {
        await this._page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
        await new Promise(r => setTimeout(r, 3000));
        await this._page.waitForSelector('[contenteditable="true"]', { timeout: 15000 });
        await new Promise(r => setTimeout(r, 1000));
      } catch (reloadErr) {
        process.stderr.write('  \u2717 page reload failed: ' + reloadErr.message + '\n');
      }
      return;
    }

    process.stderr.write('  \u2717 input not ready after recovery\n');
  }

  /**
   * Send a message to Gemini by typing into the input field.
   * @param {string} text - Message text
   * @returns {Promise<void>}
   */
  async sendMessage(text) {
    const MAX_RETRIES = 2;
    const RETRY_DELAY_MS = 2000;
    let lastError;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        await this._sendMessageOnce(text);
        return; // success
      } catch (err) {
        lastError = err;
        if (attempt < MAX_RETRIES) {
          process.stderr.write(`  ⚠ sendMessage failed (attempt ${attempt + 1}/${MAX_RETRIES + 1}): ${err.message}\n`);
          await new Promise(r => setTimeout(r, RETRY_DELAY_MS));
        }
      }
    }
    throw lastError;
  }

  /**
   * Single attempt to send a message (no retry).
   * @param {string} text
   * @returns {Promise<void>}
   * @private
   */
  async _sendMessageOnce(text) {
    this._capturedRaw = null;
    await this._waitForInputReady(30000);

    const inputEl = await this._page.$('[contenteditable="true"]');
    if (!inputEl) throw new Error('Gemini input field not found');

    // Click and focus the input via evaluate
    await this._page.evaluate(() => {
      const el = document.querySelector('[contenteditable="true"]');
      if (el) {
        el.focus();
        el.click();
      }
    });
    await new Promise(r => setTimeout(r, 200));

    // Set text via innerText + native input event
    await this._page.evaluate((msg) => {
      const el = document.querySelector('[contenteditable="true"]');
      if (el) {
        el.innerText = msg;
        el.dispatchEvent(new Event('input', { bubbles: true }));
      }
    }, text);
    await new Promise(r => setTimeout(r, 500));

    // Submit via the send button
    const sent = await this._page.evaluate(() => {
      const btn = document.querySelector('button[aria-label="Gửi tin nhắn"], button[aria-label="Send message"]');
      if (btn) { btn.click(); return true; }
      return false;
    });
    if (!sent) {
      // Fallback: press Enter
      await this._page.evaluate(() => {
        const el = document.querySelector('[contenteditable="true"]');
        if (el) {
          el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true }));
          el.dispatchEvent(new KeyboardEvent('keypress', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true }));
          el.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
        }
      });
    }
  }

  /**
   * Wait for Gemini to finish generating a response.
   * Uses short polling with stability detection — resolves when
   * 2 consecutive reads 1.5s apart return the same text, then
   * confirms the stop button has disappeared.
   * Total worst-case: ~60s vs previous ~260s.
   * @param {number} [timeoutMs=60000] - Max wait in ms
   * @returns {Promise<string>} Response text
   */
  async waitForResponse(timeoutMs = 60000) {
    const deadline = Date.now() + timeoutMs;
    let prevText = await this._getLatestResponse();

    // Phase 1: wait for response text to stabilize
    while (Date.now() < deadline) {
      let current = await this._getLatestResponse();
      if (current !== prevText) {
        prevText = current;
        // Wait 1.5s then check stability
        await new Promise(r => setTimeout(r, 1500));
        current = await this._getLatestResponse();
        if (current === prevText) {
          prevText = current;
          break;
        }
      } else {
        await new Promise(r => setTimeout(r, 500));
      }
    }

    // Phase 2: wait for stop button to disappear (max 10s, force-click at 5s)
    if (prevText) {
      const stopDeadline = Date.now() + 10000;
      let forceClicked = false;
      while (Date.now() < stopDeadline) {
        const result = await this._page.evaluate(() => {
          const btn = document.querySelector('[aria-label*="Ngừng"], [aria-label*="Stop generating"]');
          return { visible: btn ? (btn.offsetParent !== null) : false };
        });
        if (!result.visible) break;
        if (!forceClicked && Date.now() + 5000 > stopDeadline) {
          await this._page.evaluate(() => {
            const btn = document.querySelector('[aria-label*="Ngừng"], [aria-label*="Stop generating"]');
            if (btn) {
              btn.click();
              // Force-remove from DOM as backup
              btn.remove();
            }
          });
          forceClicked = true;
        }
        await new Promise(r => setTimeout(r, 500));
      }
    }

    const finalText = await this._getLatestResponse();
    // Final attempt: check if XHR captured raw response (containing angle brackets)
    // This runs AFTER the DOM has stabilized, giving XHR time to complete.
    try {
      const raw = await this._page.evaluate(() => window.__geminiRaw || null);
      if (raw && raw.length > 100) {
        const extracted = this._extractModelText(raw);
        // Only use if the extracted text is meaningfully different from DOM text
        // (DOM strips angle brackets, raw preserves them)
        if (extracted && extracted.length >= Math.max(30, finalText.length)) {
          const domCleaned = finalText.replace(/\s+/g, ' ');
          const rawCleaned = extracted.replace(/\s+/g, ' ');
          if (rawCleaned !== domCleaned) {
            return extracted.trim();
          }
        }
      }
    } catch { /* ignore */ }
    return finalText || prevText || '';
  }

  /**
   * Get the latest response text from the Gemini UI.
   * Uses DOM walking with unknown-element reconstruction to recover
   * angle-bracket expressions (e.g. `<iostream>`) that Angular
   * DomSanitizer strips from markdown rendering.
   * @returns {Promise<string>} Latest response text
   * @private
   */
  async _getLatestResponse() {
    return this._page.evaluate(() => {
      const TEMPLATE = new Set([
        'script','style','template','ng-template','ng-content','ng-container','ng-component'
      ]);
      const KNOWN = new Set([
        'a','abbr','address','article','aside','b','bdi','bdo','blockquote','br',
        'button','canvas','caption','cite','code','col','data','dd','del','details',
        'dfn','dialog','div','dl','dt','em','fieldset','figcaption','figure',
        'footer','form','h1','h2','h3','h4','h5','h6','header','hr','i','img',
        'input','ins','kbd','label','legend','li','link','main','mark','menu',
        'meta','nav','object','ol','optgroup','option','output','p','picture',
        'pre','progress','q','rp','rt','ruby','s','samp','section','select',
        'small','source','span','strong','sub','summary','sup','table','tbody',
        'td','textarea','tfoot','th','thead','time','tr','u','ul','var','video',
        'wbr',
        'response-container','response-content','model-response-text',
        'structured-content-container','message-content','thinking-overlay',
        'sources-list','gem-icon-button','gem-icon','mat-icon','code-block',
        'gemini-scrollable-container','response-element','button','source-button',
        'copy-button','feedback-buttons','election-info-disclaimer',
      ]);

      const els = document.querySelectorAll(
        '.model-response-text, model-response, response-container, [class*="response-content"]'
      );
      if (els.length === 0) return '';

      function extractText(node) {
        if (node.nodeType === 3) return node.textContent;
        if (node.nodeType !== 1) return '';
        const tag = node.tagName.toLowerCase();
        if (TEMPLATE.has(tag)) return '';
        const inner = Array.from(node.childNodes).map(extractText).join('');
        if (KNOWN.has(tag)) return inner;
        return '<' + tag + '>' + inner;
      }

      return extractText(els[els.length - 1]).trim();
    });
  }

  /**
   * Extract model output text from Gemini's raw JSON response.
   * Gemini returns a multi-section response:
   *   )]}'\n\n<N>\n[[JSON-ARRAY]]\n<N>\n[[JSON-ARRAY]]\n...
   * The model text is in the section containing "rc_" (response content).
   * It's stored as `\\u003c` (Unicode-escaped angle brackets).
   * @param {string} raw
   * @returns {string|null}
   * @private
   */
  _extractModelText(raw) {
    if (!raw || raw.length < 50) return null;

    // Strip the )]}' security prefix only, keep the trailing newlines
    // (they're needed for the \n<N>\n section separator matching)
    const cleaned = raw.replace(/^\)\]\}'/, '');
    // Split into sections by newline-separated length prefix: \n<N>\n
    const sections = cleaned.split(/\n\d+\n/);

    let best = null;

    for (const section of sections) {
      const trimmed = section.trim();
      if (!trimmed) continue;

      // Try to extract JSON from the section
      let data;
      try {
        data = JSON.parse(trimmed);
      } catch {
        const m = trimmed.match(/\[\[[\s\S]*\]\]/);
        if (m) {
          try { data = JSON.parse(m[0]); } catch { continue; }
        } else {
          continue;
        }
      }

      const isLikelyOutput = (s) => {
        if (s.length < 15) return false;
        if (/^\s*[[{]/.test(s)) return false; // looks like JSON
        if (/^[a-zA-Z0-9_-]{20,}$/.test(s)) return false; // hex ID
        // Reject URLs (Google Maps tiles, image data URIs, etc.)
        if (/^https?:\/\//i.test(s) || /^\/\//.test(s)) return false;
        // Must contain spaces (words/code tokens) or code symbols
        return (/\s/.test(s) && s.split(/\s+/).length >= 2) ||
               (/[<>{}().;=]/.test(s) && s.length >= 15);
      };

      const walk = (val, depth = 0) => {
        if (depth > 16) return;
        if (typeof val === 'string') {
          // Decode Unicode escapes (\u003c -> <)
          let decoded = val.replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) =>
            String.fromCharCode(parseInt(hex, 16))
          );
          // Try parsing as nested JSON (Gemini double-encodes the payload)
          if (decoded.startsWith('[') || decoded.startsWith('{')) {
            try {
              const nested = JSON.parse(decoded);
              walk(nested, depth + 1);
            } catch { /* not nested JSON */ }
          }
          if (isLikelyOutput(decoded)) {
            if (!best || decoded.length > best.length) best = decoded;
          }
        } else if (Array.isArray(val)) {
          val.forEach(v => walk(v, depth + 1));
        } else if (val && typeof val === 'object') {
          Object.values(val).forEach(v => walk(v, depth + 1));
        }
      };

      if (Array.isArray(data)) walk(data);
      else if (data && typeof data === 'object') Object.values(data).forEach(walk);
    }

    return best;
  }

  /**
   * Stay on the current conversation without creating a new Gemini chat session.
   * Only navigates to the Gemini URL on first init; subsequent resets reuse the
   * same conversation tab to avoid creating multiple chat entries on gemini.google.com.
   * @returns {Promise<void>}
   */
  async reset() {
    try {
      await this._page.waitForSelector('[contenteditable="true"]', { timeout: 8000 });
      // Focus the input for the next message — no navigation needed
      await this._page.evaluate(() => {
        const el = document.querySelector('[contenteditable="true"]');
        if (el) el.focus();
      });
    } catch {
      // Input not found — try reload first (preserves session)
      try {
        await this._page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
        await new Promise(r => setTimeout(r, 3000));
        await this._page.waitForSelector('[contenteditable="true"]', { timeout: 15000 });
        return;
      } catch {
        // Page may have navigated away entirely — create a fresh session
        await this._navigate(this._page, GEMINI_URL);
        await this._page.waitForSelector('[contenteditable="true"]', { timeout: 20000 });
      }
    }
  }

  /**
   * Clean up: close page and release browser reference.
   * @returns {Promise<void>}
   */
  async cleanup() {
    if (this._page) {
      try { await this._page.close(); } catch {}
      this._page = null;
    }
    releaseBrowser();
  }
}

module.exports = { GeminiClient };
