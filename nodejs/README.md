# OpenRouter Agent CLI

AI Agent CLI powered by OpenRouter API with LSP support for code intelligence.

## Features

- 🤖 **Agent Mode** - AI can use tools to complete tasks
- 🔀 **Subagent System** - Delegate tasks to parallel agents with isolated context
- 📝 **File Operations** - Read, write, list files
- 🔍 **Code Search** - Grep and find files
- 🧠 **LSP Integration** - Go to definition, find references, get symbols
- 💬 **Interactive Chat** - Conversational interface
- ⚡ **Command Execution** - Auto-detect and execute shell commands
- 📦 **Session Management** - Persistent working directory and env vars

## Installation

```bash
npm install
npm link
```

## Usage

### Basic Chat
```bash
openrouter-cli
```

### Agent Mode (with tools)
```bash
openrouter-cli --agent
```

### Environment Variables
```bash
export OPENROUTER_API_KEY=your-key
export OPENROUTER_MODEL=arcee-ai/trinity-large-preview:free
openrouter-cli --agent
```

## Available Tools

### File Operations
- `read_file` - Read file content
- `write_file` - Write to file
- `list_dir` - List directory contents

### Search
- `grep` - Search for patterns in files
- `find_files` - Find files by name pattern

### LSP (Code Intelligence)
- `goto_definition` - Jump to symbol definition
- `find_references` - Find all references to a symbol
- `get_symbols` - Get all symbols in a document

### Subagent System
- `use_subagent` - Delegate tasks to specialized agents
  - `ListAgents` - List available agents
  - `InvokeSubagents` - Run multiple agents in parallel

## Subagent System

The subagent system allows you to delegate complex tasks to specialized agents that run in parallel with isolated context.

### Example: Parallel Task Execution

```javascript
<tool>use_subagent</tool>
<params>{
    "command": "InvokeSubagents",
    "content": {
        "subagents": [
            {
                "query": "Analyze all JavaScript files in src/",
                "agent_name": "default",
                "relevant_context": "Focus on code quality"
            },
            {
                "query": "Count total lines of code",
                "agent_name": "default"
            }
        ]
    }
}</params>
```

### Benefits
- **Parallel Execution** - Multiple tasks run simultaneously
- **Context Isolation** - Each subagent has its own conversation context
- **Task Decomposition** - Break complex problems into smaller subtasks

See `examples/subagent-demo.js` for a complete example.

## LSP Support

Supported languages:
- JavaScript/TypeScript (requires `typescript-language-server`)
- Python (requires `pylsp`)
- Rust (requires `rust-analyzer`)

Install language servers:
```bash
npm install -g typescript-language-server
pip install python-lsp-server
# rust-analyzer usually comes with rustup
```

## Examples

### Create a file
```
You: write a hello world program in Python
AI: <tool>write_file</tool>
    <params>{"path": "hello.py", "content": "print('Hello World')"}</params>
```

### Find symbol definition
```
You: find the definition of function myFunc in src/index.js at line 10, column 5
AI: <tool>goto_definition</tool>
    <params>{"file": "src/index.js", "line": 10, "character": 5}</params>
```

### Delegate to subagents
```
You: analyze the codebase structure and count files in parallel
AI: <tool>use_subagent</tool>
    <params>{"command": "InvokeSubagents", "content": {"subagents": [...]}}</params>
```

## Architecture

```
src/
├── chat-bot.js          # Main chat bot logic
├── commands/            # Command parsing and execution
├── core/
│   ├── agent.js         # Agent prompt and tool parser
│   ├── lsp.js           # LSP client
│   ├── message.js       # Message handling
│   ├── session.js       # Session management
│   ├── subagent.js      # Subagent system
│   └── tools.js         # Tool registry
├── models/
│   └── openrouter.js    # OpenRouter API adapter
└── ui/                  # UI formatting and prompts
```

## License

MIT
