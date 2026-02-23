const { firefox } = require('playwright');

class BrowserManager {
    constructor(headless = true) {
        this.browser = null;
        this.context = null;
        this.headless = headless;
    }

    async launch() {
        this.browser = await firefox.launch({ 
            headless: this.headless,
            args: ['--no-sandbox']
        });
        
        this.context = await this.browser.newContext({
            userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            viewport: { width: 1280, height: 720 }
        });
        
        const page = await this.context.newPage();
        return page;
    }

    async close() {
        if (this.context) await this.context.close();
        if (this.browser) await this.browser.close();
    }
}

module.exports = { BrowserManager };
