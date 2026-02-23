const { StdinBot } = require('./src/stdin-bot');

(async () => {
    const args = process.argv.slice(2);
    const model = args.includes('--gemini') ? 'gemini' : 'chatgpt';
    
    const bot = new StdinBot(model);
    await bot.init();
    await bot.processStdin();
    await bot.close();
})().catch(e => {
    console.error("Error:", e.message);
    process.exit(1);
});
