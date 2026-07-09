---
name: hermes-agent
description: "Adapted Hermes Agent patterns for this openrouter-agent-cli project"
tags: [hermes, agent, system, configuration]
---

# Hermes Agent Patterns

This skill adapts key Hermes Agent concepts for use within this Node.js
agent CLI. Use these patterns when designing new features or improving
the agent loop.

## System Prompt Architecture

Hermes uses a layered prompt system:
1. **Environment hints** — OS, user, cwd (auto-detected)
2. **Core system prompt** — agent identity and behavior rules
3. **Loaded skills** — procedural knowledge injected on top
4. **Tool definitions** — available tools with parameter schemas

In this project, `AgentPrompt` handles layers 1-3, `ToolRegistry.getToolList()` handles layer 4.

## Tool Call Format

Hermes uses JSON function-calling (OpenAI schema) natively via `pendingToolCalls`.
This project supports three formats:
- **XML format** (primary): `<tool>name</tool><params>{...}</params>` — parsed by ToolParser
- **JSON format** (fallback): `tool_name\n{...}` — parsed by `_parseJsonFormat()`
- **Intent parser** (last resort for gemini-web): natural language => regex => tool call

Prefer native function calling when the model supports it (OpenRouter).
Use XML parsing for web-based models (Gemini Web, Claude Web).

## Tool Execution Pattern

Hermes runs tools sequentially with tool result feedback. This project does the same:

```
model response → parse tool calls → for each: execute → collect result →
  inject results into messages → model response (next turn)
```

Note the `tool_call_id` role alternation for native function calling vs.
`[Tool Results]` user-message injection for XML/JSON parsing.

## Skills System (this project)

This project's skills system mirrors Hermes:
- Skills are `.md` files in `skills/` with optional YAML frontmatter
- `skill_load` injects a skill's body into the system prompt
- `skills_list` and `skill_view` browse available skills
- Loaded skills are re-injected on every turn via `MessageHandler.getSystemContext()`

## Delegation Pattern

Hermes subagent delegation uses `delegate_task`. This project uses `use_subagent`:
- `use_subagent(command: "InvokeSubagents", content: {subagents: [...]})`
- Subagents run in parallel via `Promise.all`
- Each subagent is a fresh `ChatBot` instance

## Configuration Pattern

Hermes uses `~/.hermes/config.yaml` + `~/.hermes/.env`. This project uses:
- `.env` file for secrets (GEMINI_COOKIES, CLAUDE_COOKIES, CDP_URL, AUTO_EXEC)
- Session persistence via `SessionManager` (working dir + env vars)
