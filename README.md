# agent-cli

AI coding agent for the terminal with tool integration, streaming, diffs, and optional language-server support.

The default provider is **9Router**, using its local OpenAI-compatible Chat Completions API. Other OpenAI-compatible endpoints remain configurable through environment variables and CLI options.

## Quick start

1. Install and start [9Router](https://github.com/decolua/9router) in a separate terminal. Its default API endpoint is `http://127.0.0.1:20128/v1`.
2. In the 9Router dashboard, connect a provider and copy the API key. Select a model ID shown by your 9Router setup.
3. Configure and run this project:

```bash
cd nodejs
npm ci
cp .env.example .env
# Edit .env: set the dashboard API key and a model available in 9Router.
npm start
```

Example model IDs vary by connected provider. The upstream 9Router guide currently uses `kr/claude-sonnet-4.5`; replace it if that model is not connected in your dashboard.

For a non-interactive prompt:

```bash
printf '%s\n' 'Explain this codebase' | node bin/openrouter --chat
```

## Configuration

```dotenv
OPENAI_API_KEY=your-key-from-9router-dashboard
OPENAI_BASE_URL=http://127.0.0.1:20128/v1
OPENAI_MODEL=kr/claude-sonnet-4.5
```

`OPENAI_BASE_URL` and `OPENAI_MODEL` are optional when using the defaults. Keep the `/v1` suffix in the base URL. These `OPENAI_*` variable names are retained for compatibility; they do not force use of OpenAI. Never commit `.env` or pass real credentials on a command line where other local processes may inspect them.

Other OpenAI-compatible gateways can be selected by overriding `OPENAI_BASE_URL`, `OPENAI_API_KEY`, and `OPENAI_MODEL`.

## CLI options

```text
node bin/openrouter [options]
  --chat              Chat mode (no agent tools)
  --no-auto-execute   Do not auto-run parsed shell commands
  --model=<name>      Override OPENAI_MODEL for this run
  --base-url=<url>    Override OPENAI_BASE_URL for this run
  --api-key=<key>     Override OPENAI_API_KEY (prefer .env instead)
```

The agent asks before file writes, shell execution, package installation, symbol renames, and selected CodeGraphContext mutations by default. `--no-confirm` disables these prompts; use only when you trust the model and workspace. Shell tools execute with your operating-system user permissions, so use the CLI in a workspace with only the access you intend to grant.

## In-session commands

```text
exit              Quit
clear             Reset conversation and screen
/model <name>     Switch to another 9Router model ID
/think [on|off]   Toggle thinking display when supported
/cache [clear]    Show response-cache stats or clear cached responses
```

## Features

- Agent mode with file, shell, search, and optional MCP/CodeGraphContext tools
- Chat mode without agent tool calls
- Streaming responses and terminal markdown rendering
- Diff views for file edits
- Optional language-server diagnostics and navigation
- Subagent delegation and persistent chat history
- Context trimming and response caching

## Development

- Node.js >= 18, CommonJS
- `npm test` runs the test suite
- `npm run doctor` checks runtime dependencies

## License

MIT
