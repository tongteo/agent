# ChatGPT CLI - Refactored ✨

Modern, modular CLI for ChatGPT and Gemini without login required.

## 🎉 Refactoring Complete!

Project đã được refactor hoàn toàn để dễ bảo trì và mở rộng:

- ✅ **-40% code**: 988 → 584 dòng
- ✅ **13 modules**: Thay vì 3 files monolithic
- ✅ **Zero duplication**: Shared code giữa chat và stdin mode
- ✅ **Easy to extend**: Thêm model mới chỉ cần 1 file
- ✅ **Easy to test**: Mỗi module độc lập

## 📚 Documentation

- **[QUICKSTART.md](QUICKSTART.md)** - Bắt đầu nhanh
- **[SUMMARY.md](SUMMARY.md)** - Tổng quan refactoring
- **[ARCHITECTURE.md](ARCHITECTURE.md)** - Sơ đồ kiến trúc
- **[REFACTOR.md](REFACTOR.md)** - Chi tiết kỹ thuật

## 🚀 Quick Start

### Test refactored version
```bash
# Interactive mode
node nodejs/chat-refactored.js
node nodejs/chat-refactored.js --gemini

# Stdin mode
echo "Hello" | node nodejs/stdin-refactored.js
```

### Migrate to production
```bash
./compare.sh   # Compare old vs new
./migrate.sh   # Migrate (auto backup)
```

## 📁 New Structure

```
nodejs/
├── src/
│   ├── core/              # Core functionality
│   │   ├── browser.js     # Browser management
│   │   ├── message.js     # Message handling
│   │   └── session.js     # Session persistence
│   ├── commands/          # Command handling
│   │   ├── executor.js    # Execution
│   │   ├── parser.js      # Parsing
│   │   └── validator.js   # Validation
│   ├── ui/                # User interface
│   │   ├── formatter.js   # Output formatting
│   │   └── prompt.js      # User input
│   ├── models/            # AI adapters
│   │   ├── base.js        # Base interface
│   │   ├── chatgpt.js     # ChatGPT
│   │   └── gemini.js      # Gemini
│   ├── chat-bot.js        # Main orchestrator
│   └── stdin-bot.js       # Stdin orchestrator
├── chat-refactored.js     # Entry point
└── stdin-refactored.js    # Entry point
```

## 🎯 Key Benefits

### 1. Modularity
Mỗi module có 1 responsibility rõ ràng:
```javascript
const browser = new BrowserManager();    // Chỉ quản lý browser
const session = new SessionManager();    // Chỉ quản lý session
const executor = new CommandExecutor();  // Chỉ execute commands
```

### 2. Reusability
Code được share giữa modes:
```javascript
// Both chat and stdin use same modules
const messageHandler = new MessageHandler(model, session);
```

### 3. Extensibility
Thêm model mới = 1 file:
```javascript
// src/models/claude.js
class ClaudeAdapter extends ModelAdapter {
    // Implement 5 methods
}
```

### 4. Testability
Test từng module riêng:
```javascript
const { extractCommands } = require('./src/commands/parser');
const commands = extractCommands(response);
assert.equal(commands.length, 2);
```

## 📊 Comparison

| Aspect | Before | After |
|--------|--------|-------|
| Total Lines | 988 | 584 (-40%) |
| Files | 3 monolithic | 13 modular |
| Duplication | High | Zero |
| Testability | Low | High |
| Maintainability | Low | High |

## 💡 Example: Adding New Model

```javascript
// src/models/claude.js
const { ModelAdapter } = require('./base');

class ClaudeAdapter extends ModelAdapter {
    async init() {
        await this.page.goto('https://claude.ai');
    }
    
    async sendMessage(message) {
        await this.page.fill('.input', message);
        await this.page.click('.send');
    }
    
    // ... 3 more methods
}

module.exports = { ClaudeAdapter };
```

That's it! Works for both chat and stdin mode.

## 🧪 Testing

```bash
# Syntax check
find nodejs/src -name "*.js" -exec node -c {} \;

# Compare old vs new
./compare.sh

# Test refactored version
node nodejs/chat-refactored.js
```

## 🔧 Features

- ✅ No login required
- ✅ Interactive chat mode
- ✅ Stdin/stdout mode for piping
- ✅ Command execution with safety checks
- ✅ Session persistence (working dir, env vars)
- ✅ Syntax highlighting
- ✅ Interactive command support (vim, ssh, etc)
- ✅ Multi-model support (ChatGPT, Gemini)

## 📦 Installation

```bash
cd nodejs
npm install
```

## 🎓 Design Patterns

- **Adapter Pattern**: ModelAdapter for different AIs
- **Strategy Pattern**: Different execution strategies
- **Facade Pattern**: ChatBot/StdinBot as facades
- **Dependency Injection**: Dependencies via constructor
- **Single Responsibility**: Each class has one job

## 🛠️ Development

### Add new model
1. Create `src/models/yourmodel.js`
2. Extend `ModelAdapter`
3. Implement 5 methods
4. Done!

### Add new command validator
1. Edit `src/commands/validator.js`
2. Add validation function
3. Use in `chat-bot.js`

### Add new output format
1. Edit `src/ui/formatter.js`
2. Add format function
3. Use in message handler

## 📝 License

MIT

## 🙏 Credits

Refactored for better maintainability and extensibility.

---

**Read [QUICKSTART.md](QUICKSTART.md) to get started!**
