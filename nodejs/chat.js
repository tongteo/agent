const { ChatBot } = require('./src/chat-bot');

(async () => {
    const args = process.argv.slice(2);
    const model = args.includes('--gemini') ? 'gemini' : 'chatgpt';
    const agentMode = args.includes('--agent');
    const loginMode = args.includes('--login');
    
    const bot = new ChatBot(model, agentMode, loginMode);
    await bot.init();
    await bot.chat();
})().catch(e => {
    console.error("❌ Error:", e.message);
    process.exit(1);
});
