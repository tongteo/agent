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

## Commands

- `exit` - Quit
- `clear` - Clear history  
- `/model <name>` - Switch model
- `/think` - Toggle thinking display
