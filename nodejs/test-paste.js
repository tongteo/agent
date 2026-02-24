const { PromptManager } = require('./src/ui/prompt');

const pm = new PromptManager();
pm.init();

console.log('Test paste by copying and pasting text:');
console.log('Example: "Write C++ BFS algorithm"\n');

pm.ask('👤 You: ').then(answer => {
    console.log('\nYou entered:', answer);
    console.log('Length:', answer.length);
    process.exit(0);
});
