const { firefox } = require('playwright');

class BrowserManager {
    constructor() {
        this.browser = null;
        this.page = null;
    }

    async launch() {
        this.browser = await firefox.launch({ headless: true });
        const context = await this.browser.newContext({
            userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.3.1 Mobile/15E148 Safari/604.1"
        });
        this.page = await context.newPage();
        return this.page;
    }

    async close() {
        if (this.browser) await this.browser.close();
    }
}

module.exports = { BrowserManager };
