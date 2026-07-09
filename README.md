# OpenRouter Agent CLI

Terminal-based AI agent with tool integration, LSP support, and Playwright-based web providers (Gemini/Claude). Built with Node.js.

## Quick Start

```bash
cd nodejs
npm install
npm test       # 181+ tests
npm start      # launch interactive CLI
# or: node bin/openrouter
```

## Features

- **Chat loop** — interactive or piped (stdin) conversation
- **Tool execution** — read/write files, run commands, search code, web browsing, file patching, delegation
- **Provider support**: OpenRouter API (native function calling), Gemini Web & Claude Web (Playwright + CDP)
- **Skills system** — loadable `.md` skill files with YAML frontmatter; model can list, view, load, search, create, edit, and delete skills at runtime
- **Subagent delegation** — spawn parallel child agents in isolated contexts
- **Context management** — token counting with automatic history trimming
- **LSP integration** — autocomplete, diagnostics, go-to-definition via LSP tools
- **Session persistence** — working directory and env survive across sessions
- **Security validator** — flags dangerous commands before execution

## Configuration

Create `nodejs/.env`:

```env
# OpenRouter (recommended)
OPENROUTER_API_KEY=sk-...

# Gemini Web (cookie-based)
GEMINI_COOKIES=1

# Claude Web (cookie-based)
CLAUDE_COOKIES=1
```

## Tool Format

```
<tool>tool_name</tool>
<params>{"key": "value"}</params>
```

JSON and natural-language intent parsing as fallbacks.

## Adding a New Tool

1. Create `src/core/tools/<name>.js`
2. Export from `src/core/tools/index.js` (ToolRegistry)
3. Add tool name to `ToolParser.TOOL_NAMES` in `src/core/agent.js`
4. Write tests in `tests/test-<name>.js`

## Development

- JavaScript (Node.js >= 18), CommonJS, 2-space indent
- `npm test` from `nodejs/`, `npm run doctor` to verify dependencies

## License

MIT
