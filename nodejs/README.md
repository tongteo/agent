# agent-cli

AI agent CLI — terminal-based agent with tool integration, streaming, diff views, and LSP support.

Connects to any **OpenAI-compatible API** (OpenRouter, OmniRoute, vLLM, Ollama, etc.) via `/v1/chat/completions` with SSE streaming.

## Features

- **Agent mode** — model uses tools (read, write, edit files, run bash, search, etc.)
- **Chat mode** — plain conversation without tool calls
- **Streaming** with real-time display + spinner
- **Diff views** — color-coded syntax-highlighted diffs on file writes
- **Markdown rendering** — headers, code blocks, tables, inline code, LaTeX
- **LSP integration** — diagnostics, go-to-definition, hover (optional)
- **Subagent delegation** — spawn isolated sub-agents for parallel tasks
- **Auto-fix** — detect C compilation loops and fix common errors
- **Session persistence** — conversation history survives restarts

## Quick Start

```bash
npm install
cp .env.example .env   # set OPENAI_API_KEY, OPENAI_BASE_URL, OPENAI_MODEL
node bin/openrouter
```

## CLI Options

```
node bin/openrouter [options]

  --chat              Chat mode (no tool calls)
  --no-auto-execute   Don't auto-run compile/exec from model output
  --model=<name>      Override OPENAI_MODEL
  --base-url=<url>    Override OPENAI_BASE_URL
  --api-key=<key>     Override OPENAI_API_KEY
```

## Environment Variables

```bash
OPENAI_API_KEY=sk-...        # Required
OPENAI_BASE_URL=http://...   # Any OpenAI-compatible endpoint
OPENAI_MODEL=gpt-4o          # Model name
```

## In-Session Commands

```
exit              Quit
clear             Reset conversation + screen
/model <name>     Switch model
/think [on|off]   Toggle thinking display
```

## Project Structure

```
bin/openrouter         Entry point
src/
  chat-bot.js          Main chat loop, tool orchestration
  models/
    openai-adapter.js  OpenAI-compatible streaming adapter
  core/
    agent.js           System prompt, tool/intent parsers
    tools/             Tool implementations (file ops, bash, etc.)
    session.js         Persistent session + working dir
    subagent.js        Sub-agent spawning
    lsp.js             LSP client (diagnostics, completions)
  ui/
    formatter.js       Markdown → terminal rendering
    diff.js            Syntax-highlighted file diffs
    prompt.js          Raw-mode input with history + tab complete
  commands/
    executor.js        Shell command runner (bash, cd, export)
tests/
```

## License

MIT
