# Agent CLI

AI agent with LSP support. Multiple providers: Gemini, Claude, OpenRouter, Ollama, Anthropic, Custom API.

## Setup

```bash
npm install
cp .env.example .env
# Edit .env with your API key
```

## Run

```bash
node bin/openrouter          # agent mode
node bin/openrouter --chat   # chat mode
```

### Global Command (Optional)

Run `agent` from any directory:

```bash
# Create symlink
sudo ln -s $(pwd)/bin/openrouter /usr/local/bin/agent

# Or add alias to ~/.bashrc or ~/.zshrc
echo "alias agent='node $(pwd)/bin/openrouter'" >> ~/.bashrc
source ~/.bashrc

# Usage
agent                        # agent mode
agent --chat                 # chat mode
```

## Commands

- `exit` - Quit
- `clear` - Clear history  
- `/model <name>` - Switch model
- `/think` - Toggle thinking display
