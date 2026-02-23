# Architecture Diagram

## Old Structure (Monolithic)

```
┌─────────────────────────────────────────┐
│           chat.js (624 lines)           │
│  ┌────────────────────────────────────┐ │
│  │ Browser Setup                      │ │
│  │ Message Sending                    │ │
│  │ Response Streaming                 │ │
│  │ Command Parsing                    │ │
│  │ Command Execution                  │ │
│  │ Session Management                 │ │
│  │ Output Formatting                  │ │
│  │ User Input                         │ │
│  │ ChatGPT Logic                      │ │
│  │ Gemini Logic                       │ │
│  └────────────────────────────────────┘ │
└─────────────────────────────────────────┘

┌─────────────────────────────────────────┐
│          stdin.js (153 lines)           │
│  ┌────────────────────────────────────┐ │
│  │ Browser Setup (DUPLICATE)          │ │
│  │ Message Sending (DUPLICATE)        │ │
│  │ Response Handling (DUPLICATE)      │ │
│  │ ChatGPT Logic (DUPLICATE)          │ │
│  │ Gemini Logic (DUPLICATE)           │ │
│  └────────────────────────────────────┘ │
└─────────────────────────────────────────┘

Problems:
❌ Code duplication
❌ Mixed concerns
❌ Hard to test
❌ Hard to extend
```

## New Structure (Modular)

```
┌──────────────────────────────────────────────────────────────┐
│                      chat-bot.js                             │
│                   (Main Orchestrator)                        │
└────────────┬─────────────────────────────────────┬───────────┘
             │                                     │
    ┌────────▼────────┐                  ┌────────▼────────┐
    │  BrowserManager │                  │ SessionManager  │
    │   (browser.js)  │                  │  (session.js)   │
    └────────┬────────┘                  └────────┬────────┘
             │                                     │
             │         ┌──────────────────────────┘
             │         │
    ┌────────▼─────────▼────────┐
    │    MessageHandler          │
    │     (message.js)           │
    └────────┬───────────────────┘
             │
    ┌────────▼────────┐
    │  Model Adapter  │
    │   (base.js)     │
    └────────┬────────┘
             │
      ┌──────┴──────┐
      │             │
┌─────▼─────┐ ┌────▼──────┐
│  ChatGPT  │ │  Gemini   │
│ Adapter   │ │  Adapter  │
└───────────┘ └───────────┘

┌──────────────────────────────────────────┐
│         Command Processing               │
├──────────────────────────────────────────┤
│  Parser → Validator → Executor           │
│  (parser.js) (validator.js) (executor.js)│
└──────────────────────────────────────────┘

┌──────────────────────────────────────────┐
│              UI Layer                    │
├──────────────────────────────────────────┤
│  Formatter          PromptManager        │
│  (formatter.js)     (prompt.js)          │
└──────────────────────────────────────────┘

Benefits:
✅ No duplication (shared modules)
✅ Clear separation
✅ Easy to test
✅ Easy to extend
```

## Data Flow

### Interactive Mode (chat-bot.js)

```
User Input
    │
    ▼
PromptManager.ask()
    │
    ▼
MessageHandler.send()
    │
    ├─→ SessionManager.getContext()
    │
    └─→ ModelAdapter.sendMessage()
            │
            ▼
        BrowserManager.page
            │
            ▼
    MessageHandler.stream()
            │
            ▼
    Formatter.formatMath()
            │
            ▼
    Parser.extractCommands()
            │
            ▼
    Validator.isDangerous()
            │
            ▼
    Executor.execute()
            │
            ├─→ SessionManager.updateWorkingDir()
            │
            └─→ Output
```

### Stdin Mode (stdin-bot.js)

```
Stdin Input
    │
    ▼
MessageHandler.send()
    │
    └─→ ModelAdapter.sendMessage()
            │
            ▼
    MessageHandler.getLastResponse()
            │
            ▼
        Stdout Output
```

## Module Dependencies

```
chat-bot.js
├── core/browser.js
├── core/session.js
├── core/message.js
│   └── models/base.js
│       ├── models/chatgpt.js
│       └── models/gemini.js
├── commands/parser.js
├── commands/validator.js
├── commands/executor.js
│   └── core/session.js (shared)
├── ui/formatter.js
└── ui/prompt.js

stdin-bot.js
├── core/browser.js (shared)
├── core/session.js (shared)
├── core/message.js (shared)
│   └── models/* (shared)
```

## Comparison: Adding a New Feature

### Old Way (Monolithic)
```
Want to add Claude support?
1. Edit chat.js (624 lines) - find right place
2. Add Claude logic mixed with ChatGPT/Gemini
3. Edit stdin.js (153 lines) - duplicate logic
4. Risk breaking existing code
5. Hard to test in isolation
```

### New Way (Modular)
```
Want to add Claude support?
1. Create src/models/claude.js (50 lines)
2. Implement 5 methods from ModelAdapter
3. Done! Works for both chat and stdin
4. Easy to test: just test claude.js
5. Zero risk to existing code
```

## Testing Strategy

```
Unit Tests (per module)
├── core/
│   ├── browser.test.js
│   ├── message.test.js
│   └── session.test.js
├── commands/
│   ├── parser.test.js
│   ├── validator.test.js
│   └── executor.test.js
├── models/
│   ├── chatgpt.test.js
│   └── gemini.test.js
└── ui/
    ├── formatter.test.js
    └── prompt.test.js

Integration Tests
├── chat-bot.test.js
└── stdin-bot.test.js

E2E Tests
├── chatgpt-flow.test.js
└── gemini-flow.test.js
```
