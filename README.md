# ChatGPT CLI

CLI tool for ChatGPT and Gemini without login required.

## Features

- ✅ No login required (optional login for higher rate limits)
- ✅ Interactive chat mode
- ✅ Stdin/stdout mode for piping
- ✅ **AI Agent mode with tools** 🆕
- ✅ **Session persistence with cookies** 🆕
- ✅ Auto command execution with safety checks
- ✅ Session persistence (working dir, env vars)
- ✅ Syntax highlighting
- ✅ Interactive commands (vim, ssh, etc)
- ✅ Multi-model support (ChatGPT, Gemini)

## Installation

```bash
git clone https://github.com/tongteo/agent.git
cd agent/nodejs
npm install
```

## Usage

### Interactive mode
```bash
node chat.js              # ChatGPT
node chat.js --gemini     # Gemini
node chat.js --agent      # ChatGPT Agent Mode 🆕
node chat.js --login      # Login mode (higher rate limits) 🆕
node chat.js --agent --login  # Agent + Login
```

### Agent Mode 🆕
Agent mode gives AI access to tools for file operations and code search:

```bash
node chat.js --agent

# Example commands:
# "read the file package.json"
# "list all JavaScript files"
# "search for TODO in the code"
# "write hello world to test.txt"
```

**Available Tools:**
- `read_file` - Read file content
- `write_file` - Write to file
- `list_dir` - List directory contents
- `grep` - Search in files
- `find_files` - Find files by pattern

### Stdin mode
```bash
echo "What is 2+2?" | node stdin.js
cat file.txt | node stdin.js --gemini
```

### Commands
- `exit` - Quit
- `clear` - New conversation
- `logout` - Clear saved login session 🆕
- `y` - Execute all commands
- `n` - Skip commands
- `select` - Choose specific command

### Auto-execute mode
```bash
AUTO_EXEC=true node chat.js
```

## TODO

- [ ] Add Claude support
- [ ] Add unit tests
- [ ] Add config file
- [ ] Add plugin system
- [ ] Add logging
- [x] Add AI agent mode with tools

## License

MIT
