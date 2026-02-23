# ChatGPT CLI - Refactored

## Cấu trúc mới

```
nodejs/
├── src/
│   ├── core/              # Core functionality
│   │   ├── browser.js     # Browser & page management
│   │   ├── message.js     # Message sending/receiving/streaming
│   │   └── session.js     # Session persistence (working dir, env vars)
│   ├── commands/          # Command handling
│   │   ├── executor.js    # Command execution (shell, cd, export, interactive)
│   │   ├── parser.js      # Extract commands from AI responses
│   │   └── validator.js   # Safety checks (dangerous commands)
│   ├── ui/                # User interface
│   │   ├── formatter.js   # Output formatting & syntax highlighting
│   │   └── prompt.js      # User input handling
│   ├── models/            # AI model adapters
│   │   ├── base.js        # Base adapter interface
│   │   ├── chatgpt.js     # ChatGPT-specific implementation
│   │   └── gemini.js      # Gemini-specific implementation
│   ├── chat-bot.js        # Main orchestrator (interactive mode)
│   └── stdin-bot.js       # Stdin mode orchestrator
├── chat-refactored.js     # Entry point for interactive mode
├── stdin-refactored.js    # Entry point for stdin mode
└── package.json
```

## Lợi ích của refactor

### 1. Separation of Concerns
- **Core**: Browser, messaging, session management
- **Commands**: Parsing, validation, execution
- **UI**: Formatting, user input
- **Models**: AI-specific logic isolated

### 2. Reusability
- `BrowserManager` dùng chung cho cả chat và stdin mode
- `MessageHandler` tách biệt logic gửi/nhận message
- `CommandExecutor` có thể test độc lập

### 3. Maintainability
- Mỗi file < 150 dòng (thay vì 700+ dòng)
- Single Responsibility Principle
- Dễ tìm và fix bugs

### 4. Extensibility
- Thêm model mới: chỉ cần implement `ModelAdapter`
- Thêm command validator: extend `validator.js`
- Thêm output format: extend `formatter.js`

### 5. Testability
- Mỗi module có thể test riêng
- Mock dependencies dễ dàng
- Unit test cho từng chức năng

## Migration Plan

### Phase 1: Testing (hiện tại)
```bash
# Test refactored version
node nodejs/chat-refactored.js
node nodejs/chat-refactored.js --gemini

# Test stdin mode
echo "Hello" | node nodejs/stdin-refactored.js
```

### Phase 2: Update bin files
```bash
# Update bin/chatgpt
#!/usr/bin/env node
require('../chat-refactored.js');

# Update bin/gemini
#!/usr/bin/env node
process.argv.push('--gemini');
require('../chat-refactored.js');

# Similar for stdin versions
```

### Phase 3: Cleanup
```bash
# Remove old files after testing
rm nodejs/chat.js
rm nodejs/stdin.js
rm gpt.js  # Old unused file

# Rename refactored files
mv nodejs/chat-refactored.js nodejs/chat.js
mv nodejs/stdin-refactored.js nodejs/stdin.js
```

## Code Quality Improvements

### Before
- 1 file, 700+ lines
- Mixed responsibilities
- Hard to test
- Duplicate code between chat.js and stdin.js

### After
- 11 files, ~100 lines each
- Clear responsibilities
- Easy to test
- Shared code in modules

## Example: Adding a new model

```javascript
// src/models/claude.js
const { ModelAdapter } = require('./base');

class ClaudeAdapter extends ModelAdapter {
    async init() {
        await this.page.goto('https://claude.ai', { waitUntil: 'networkidle' });
        await this.page.waitForTimeout(3000);
    }

    async sendMessage(message) {
        // Claude-specific implementation
    }

    async waitForResponse(messageCount) {
        // Claude-specific implementation
    }

    getResponseSelector() {
        return '.claude-response';
    }

    async isStreaming() {
        return await this.page.$('.stop-button') !== null;
    }
}

module.exports = { ClaudeAdapter };
```

## Example: Adding a new command validator

```javascript
// src/commands/validator.js
function isResourceIntensive(command) {
    const intensive = ['find /', 'grep -r /', 'tar -czf'];
    return intensive.some(cmd => command.includes(cmd));
}

async function confirmResourceIntensive(command, question) {
    console.log(chalk.yellow(`\n⚠️  RESOURCE INTENSIVE: ${command}`));
    const confirm = await question('Continue? (yes/no): ');
    return confirm.toLowerCase() === 'yes';
}

module.exports = { 
    isDangerous, 
    isInteractive, 
    isResourceIntensive,
    confirmDangerous,
    confirmResourceIntensive
};
```
