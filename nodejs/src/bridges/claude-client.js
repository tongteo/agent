/**
 * @fileoverview Claude web client — drives Claude AI through Playwright (CDP).
 * Sends messages and retrieves responses by interacting with the Claude web UI.
 */

const { getBrowser, releaseBrowser } = require('./browser-manager');
const fs = require('fs');
const path = require('path');

/** @type {string} Claude web app URL */
const CLAUDE_URL = 'https://claude.ai';

/** @type {string} Path to Claude cookies file */
const COOKIES_PATH = path.join(__dirname, '../../claude_cookies.json');

class ClaudeClient {
  constructor() {
    /** @type {import('puppeteer-core').Page|null} */
    this._page = null;
  }

  /**
   * Initialize: open a new browser page, inject cookies, and navigate to Claude.
   * @returns {Promise<void>}
   */
  async init() {
    const browser = await getBrowser();
    this._page = await browser.newPage();
    await this._page.setViewport({ width: 1280, height: 720 });
    
    // Hide automation flags from Cloudflare
    await this._page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
    });
    
    // Inject cookies before navigation
    await this._injectCookies(this._page);
    
    await this._page.goto(CLAUDE_URL, { waitUntil: 'load', timeout: 60000 });

    // Give the SPA time to bootstrap and cookies to apply
    await new Promise(r => setTimeout(r, 5000));

    // Wait for input to become available (indicates successful login)
    const maxWait = 60000;
    const deadline = Date.now() + maxWait;
    while (Date.now() < deadline) {
      // Use evaluate() in a single call to avoid cross-context issues
      const state = await this._page.evaluate(() => {
        const url = window.location.href;
        const title = document.title;
        const input = document.querySelector(
          'textarea[placeholder*="message" i], div[contenteditable="true"], [role="textbox"], [data-testid="chat-input"]'
        );
        return {
          url,
          onLogin: url.includes('/login') || url.includes('/signin') || url.includes('auth'),
          onChallenge: title.includes('Just a moment') || url.includes('challenge'),
          hasInput: !!input
        };
      }).catch(() => ({ url: '', onLogin: false, onChallenge: true, hasInput: false }));

      if (state.onChallenge) {
        await new Promise(r => setTimeout(r, 1000));
        continue;
      }
      if (state.onLogin) {
        throw new Error('Claude cookies expired or invalid. Please export fresh cookies from a logged-in browser to claude_cookies.json.');
      }
      if (state.hasInput) {
        return; // Success
      }
      await new Promise(r => setTimeout(r, 1000));
    }

    // Final fallback
    await this._page.waitForSelector(
      'textarea[placeholder*="message" i], div[contenteditable="true"], [role="textbox"], [data-testid="chat-input"]',
      { timeout: 10000 }
    );
  }

  /**
   * Load cookies from claude_cookies.json and set them on the page.
   * @param {import('puppeteer-core').Page} page
   * @returns {Promise<void>}
   * @private
   */
  async _injectCookies(page) {
    let raw;
    try {
      raw = fs.readFileSync(COOKIES_PATH, 'utf8');
    } catch {
      console.error('  ✗ claude_cookies.json not found at ' + COOKIES_PATH);
      throw new Error('Missing claude_cookies.json — export cookies from a logged-in Claude browser session');
    }

    /** @type {Array<{domain: string, name: string, value: string, secure?: boolean, httpOnly?: boolean, path?: string, sameSite?: string}>} */
    let cookies;
    try {
      cookies = JSON.parse(raw);
    } catch {
      throw new Error('Invalid claude_cookies.json: not valid JSON');
    }

    // Normalise cookie properties for Puppeteer
    for (const c of cookies) {
      if (c.name && c.name.startsWith('__Secure-')) {
        c.secure = true;
      }
      if (c.domain && c.domain.startsWith('.')) {
        c.domain = c.domain.substring(1);
      }
      if (typeof c.httpOnly !== 'boolean') c.httpOnly = false;
      if (typeof c.secure !== 'boolean') c.secure = true;
      if (c.sameSite === 'unspecified' || !c.sameSite) c.sameSite = 'Lax';
      if (!c.path) c.path = '/';
    }

    // Filter out cookies whose value is a placeholder/redacted
    const validCookies = cookies.filter(c => c.value && !c.value.startsWith('YOUR_') && !c.value.includes('redacted'));
    if (validCookies.length === 0) {
      throw new Error('All cookies in claude_cookies.json are placeholders. Export real cookies from a logged-in browser.');
    }

    await page.setCookie(...validCookies);
    console.log(`  ✓ Loaded ${validCookies.length} cookies from claude_cookies.json`);
  }

  /**
   * Send a message to Claude by typing into the textarea.
   * @param {string} text - Message text
   * @returns {Promise<void>}
   */
  async sendMessage(text) {
    // Try multiple selectors in order, prefer data-testid
    const selectors = [
      '[data-testid="chat-input"]',
      'textarea[placeholder*="message" i]',
      '[role="textbox"]',
      'div[contenteditable="true"]',
      'textarea'
    ];
    
    let input = null;
    for (const sel of selectors) {
      input = await this._page.$(sel);
      if (input) break;
    }
    
    if (!input) {
      throw new Error('Could not find Claude input field');
    }
    
    // Focus the input
    await input.click();
    await new Promise(r => setTimeout(r, 200));
    await input.focus();
    await new Promise(r => setTimeout(r, 100));

    // Use paste event to insert text — ProseMirror handles paste properly
    // preserving newlines and all content
    await this._page.evaluate((msg) => {
      const el = document.querySelector('[data-testid="chat-input"]');
      if (!el) return;
      el.focus();
      
      // Clear existing content
      el.innerText = '';
      el.dispatchEvent(new Event('input', { bubbles: true }));
      
      // Use paste event which ProseMirror/TipTap handles natively
      // Pasted content preserves all formatting including newlines
      const dt = new DataTransfer();
      dt.setData('text/plain', msg);
      el.dispatchEvent(new ClipboardEvent('paste', {
        clipboardData: dt,
        bubbles: true,
        cancelable: true
      }));
    }, text);

    await new Promise(r => setTimeout(r, 600));

    // Verify text was inserted, then press Enter
    const hasText = await this._page.evaluate(() => {
      const el = document.querySelector('[data-testid="chat-input"]');
      return el ? el.textContent.trim().length > 5 : false;
    });

    if (!hasText) {
      // Fallback: type character by character if execCommand didn't work
      await this._page.keyboard.type(text, { delay: 5 });
      await new Promise(r => setTimeout(r, 500));
    }

    await this._page.keyboard.press('Enter');
    await new Promise(r => setTimeout(r, 2000));

    // If text still there, click send button instead
    const stillThere = await this._page.evaluate(() => {
      const el = document.querySelector('[data-testid="chat-input"]');
      return el ? el.textContent.trim().length > 3 : false;
    });

    if (stillThere) {
      await this._page.evaluate(() => {
        const buttons = document.querySelectorAll('button');
        for (const b of buttons) {
          const label = b.getAttribute('aria-label') || '';
          if (label.toLowerCase().includes('send')) { b.click(); return true; }
        }
        // Also try looking for submit buttons
        document.querySelector('[type="submit"], button[class*="send"]')?.click();
      });
    }
  }

  /**
   * Wait for Claude to finish generating a response.
   * Short polling with stability detection — 60s max instead of 120s.
   * @param {number} [timeoutMs=60000] - Max wait in ms
   * @returns {Promise<string>} Response text
   */
  async waitForResponse(timeoutMs = 90000) {
    const deadline = Date.now() + timeoutMs;
    let retries = 0;
    const maxRetries = 3;

    const poll = async () => {
      await new Promise(r => setTimeout(r, 3000));
      let prev = '';
      while (Date.now() < deadline) {
        await new Promise(r => setTimeout(r, 500));
        const text = await this._getLatestResponse();
        if (text && text === prev && text.length > 0) return text;
        if (text) prev = text;

        // Check if generation failed (Retry button visible)
        if (retries < maxRetries) {
          const hasRetry = await this._page.evaluate(() => {
            const btns = document.querySelectorAll('button');
            for (const b of btns) {
              if (b.getAttribute('aria-label') === 'Retry') return true;
            }
            return false;
          });
          if (hasRetry) {
            retries++;
            console.error('  \u21bb Claude generation failed, clicking Retry (attempt ' + retries + '/' + maxRetries + ')');
            await this._page.evaluate(() => {
              const btns = document.querySelectorAll('button');
              for (const b of btns) {
                if (b.getAttribute('aria-label') === 'Retry') { b.click(); return; }
              }
            });
            // Wait longer after retry for generation to start
            await new Promise(r => setTimeout(r, 5000));
            prev = '';
            continue;
          }
        }
      }
      return prev || (await this._getLatestResponse() || '');
    };

    return poll();
  }

  /**
   * Get the latest assistant response text from the Claude UI.
   * @returns {Promise<string>} Latest response text
   * @private
   */
  async _getLatestResponse() {
    return this._page.evaluate(() => {
      // Claude renders assistant responses inside .font-claude-response-body
      const els = document.querySelectorAll('.font-claude-response-body');
      if (els.length > 0) {
        return els[els.length - 1].textContent.trim();
      }
      // Fallback: try other selectors for different Claude UI versions
      const fallbacks = [
        '[data-testid="assistant-message"]',
        '[data-message-author-role="assistant"]',
        '[class*="font-claude-response"]'
      ];
      for (const sel of fallbacks) {
        const fEls = document.querySelectorAll(sel);
        if (fEls.length > 0) {
          return fEls[fEls.length - 1].textContent.trim();
        }
      }
      return '';
    });
  }

  /**
   * Reset to a new conversation.
   * @returns {Promise<void>}
   */
  async reset() {
    const newChat = await this._page.$('a[href*="new"]');
    if (newChat) {
      await newChat.click();
    } else {
      await this._page.goto(CLAUDE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    }
    
    // Wait for input to be ready
    await new Promise(r => setTimeout(r, 2000));
    const input = await this._page.$('textarea[placeholder*="message" i], [role="textbox"], div[contenteditable="true"], [data-testid="chat-input"]');
    if (!input) {
      throw new Error('Failed to reset Claude conversation - input not found');
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

module.exports = { ClaudeClient };
