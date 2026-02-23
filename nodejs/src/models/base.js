class ModelAdapter {
    constructor(page) {
        this.page = page;
    }

    async init() {
        throw new Error('Must implement init()');
    }

    async sendMessage(message) {
        throw new Error('Must implement sendMessage()');
    }

    async waitForResponse(messageCount) {
        throw new Error('Must implement waitForResponse()');
    }

    getResponseSelector() {
        throw new Error('Must implement getResponseSelector()');
    }
}

module.exports = { ModelAdapter };
