# ChatGPT CLI

CLI tool for ChatGPT and Gemini without login required.

## Features

- ✅ No login required
- ✅ Interactive chat mode
- ✅ Stdin/stdout mode for piping
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
```

### Stdin mode
```bash
echo "What is 2+2?" | node stdin.js
cat file.txt | node stdin.js --gemini
```

### Commands
- `exit` - Quit
- `clear` - New conversation
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

## Documentation

- [ARCHITECTURE.md](ARCHITECTURE.md) - Architecture overview
- [REFACTOR.md](REFACTOR.md) - Technical details

## License

MIT
