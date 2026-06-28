# Agent CLI

AI agent running in terminal. Supports multiple models: Gemini, Claude, OpenRouter, Ollama, Custom API.

## Installation

```bash
cd nodejs
npm install
cp .env.example .env
```

## `.env` Configuration

Choose one of the providers:

| Provider | Required variables |
|---|---|
| Gemini Web (cookies) | `GEMINI_COOKIES=1` |
| Claude Web (cookies) | `CLAUDE_COOKIES=1` |
| OpenRouter | `OPENROUTER_API_KEY`, `OPENROUTER_MODEL` |
| Gemini API | `GEMINI_API_KEY` |
| Ollama | `OLLAMA_MODEL` |
| Custom API | `CUSTOM_API_BASE`, `CUSTOM_API_KEY`, `CUSTOM_MODEL` |

**Gemini/Claude Web** requires cookies files at:
- `src/bridges/gemini_cookies.json`
- `src/bridges/claude_cookies.json`

## Run

```bash
node bin/openrouter          # agent mode (default)
node bin/openrouter --chat   # chat mode
```

## Chat Commands

| Command | Description |
|---|---|
| `exit` | Quit |
| `clear` | Clear history |
| `/model <name>` | Switch model |
| `/model <provider> <name>` | Switch provider |
| `/model list` | List Ollama models |
| `/think` | Toggle thinking display |
