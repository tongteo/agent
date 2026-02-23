const fs = require('fs');
const path = require('path');
const os = require('os');

class AuthManager {
    constructor(modelType = 'chatgpt') {
        this.modelType = modelType;
        this.cookieFile = path.join(os.homedir(), `.${modelType}-cookies.json`);
    }

    hasSavedCookies() {
        return fs.existsSync(this.cookieFile);
    }

    async saveCookies(context) {
        const cookies = await context.cookies();
        fs.writeFileSync(this.cookieFile, JSON.stringify(cookies, null, 2));
        console.log(`✓ Cookies saved to ${this.cookieFile}`);
    }

    async loadCookies(context) {
        if (!this.hasSavedCookies()) return false;
        
        try {
            const cookies = JSON.parse(fs.readFileSync(this.cookieFile, 'utf-8'));
            await context.addCookies(cookies);
            return true;
        } catch (e) {
            console.error(`Failed to load cookies: ${e.message}`);
            return false;
        }
    }

    clearCookies() {
        if (fs.existsSync(this.cookieFile)) {
            fs.unlinkSync(this.cookieFile);
            console.log('✓ Cookies cleared');
        }
    }

    async isLoggedIn(page, modelType) {
        if (modelType === 'chatgpt') {
            // Check for user menu or profile indicator
            const loggedIn = await page.$('[data-testid="profile-button"]') !== null ||
                           await page.$('nav img[alt*="User"]') !== null;
            return loggedIn;
        } else if (modelType === 'gemini') {
            // Check for Google account indicator
            const loggedIn = await page.$('[aria-label*="Google Account"]') !== null ||
                           await page.$('img[alt*="Profile"]') !== null;
            return loggedIn;
        }
        return false;
    }

    async waitForLogin(page, modelType) {
        console.log('\n🔐 Please login in the browser window...');
        console.log('   Waiting for login to complete (timeout: 5 minutes)...\n');
        
        const timeout = 5 * 60 * 1000; // 5 minutes
        const startTime = Date.now();
        
        while (Date.now() - startTime < timeout) {
            if (await this.isLoggedIn(page, modelType)) {
                console.log('✓ Login detected!\n');
                return true;
            }
            await page.waitForTimeout(2000);
        }
        
        console.log('⚠️  Login timeout. Continuing without login...\n');
        return false;
    }
}

module.exports = { AuthManager };
