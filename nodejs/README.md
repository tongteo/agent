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
| Anthropic API | `ANTHROPIC_BASE_URL`, `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` |
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

## Features

### Tools Available

**File Operations:**
- `read_file`, `write_file`, `list_dir`, `read_lines`
- `str_replace`, `insert_at_line`, `append`
- `grep`, `find_files`

**Code Intelligence (LSP):**
- `goto_definition`, `find_references`, `get_symbols`
- `get_diagnostics`, `rename_symbol`, `workspace_symbols`

**Development:**
- `bash` - Execute shell commands
- `execute` - Run programs with structured output
- `git` - Git operations (commit, push, branch)
- `tree` - Directory tree view
- `analyze_code` - Code analysis
- `package_install` - Install npm/pip/cargo packages
- `debug_trace` - Show code context around line

**Advanced:**
- `use_subagent` - Delegate to parallel subagents
- `internet_search` - Web search (requires `UNLIMITED_API_KEY` or `ANTHROPIC_API_KEY`)

### API Retry Mechanism

Anthropic adapter automatically retries failed requests:
- 10 retries with 15s intervals
- Handles both HTTP and streaming errors
- Shows retry progress in output
