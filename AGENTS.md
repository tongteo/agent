# OpenRouter Agent CLI

AI Agent CLI built with Node.js — terminal-based agent with tool integration, LSP support, and Playwright-based web providers (Gemini/Claude).

## Quick Start

```bash
cd /root/agent/nodejs
npm install
npm test          # 88+ tests must pass
npm start         # run the agent
```

## Project Layout

```
/root/agent/
├── nodejs/               ← source code
│   ├── bin/openrouter    ← entry point
│   ├── src/
│   │   ├── chat-bot.js   ← main loop
│   │   ├── core/         ← agent prompts, tools, LSP, context, sessions
│   │   ├── commands/     ← shell executor + security validator
│   │   ├── ui/           ← prompt, markdown render, diff display
│   │   ├── models/       ← Gemini/Claude web adapters
│   │   └── bridges/      ← Playwright CDP drivers
│   └── tests/            ← unit tests
└── .hermes.md            ← Hermes-specific instructions (also covers this project)
```

## Key Rules

1. **Tool format**: `<tool>name</tool><params>{...}</params>` — the primary contract with the model
2. **Sequential execution**: tools run one-at-a-time (later tools depend on earlier side effects)
3. **JSDoc**: all exported functions must have `/** ... */` documentation
4. **Tests**: `npm test` before and after every change — 106+ unit tests, zero failures allowed
5. **Lifecycle**: function calling (OpenRouter native) preferred; XML parser is fallback; intent parser is last resort for gemini-web

## Skills System

Skills are `.md` files in `nodejs/skills/` with optional YAML frontmatter.
Five tools let the model fully manage skills:
- `skills_list` — browse available skills (optional filter)
- `skill_view` — read full content
- `skill_load` — inject into system prompt for the session
- `skill_search` — full-text search across all skills
- `skill_manage` — create, edit, patch, or delete skills (self-improvement)

The model can discover, load, create, and update skills at runtime —
similar to Hermes Agent's skills lifecycle. See `.hermes.md` for full details.

## Agent skills

### Issue tracker

Issues tracked on GitHub via `gh` CLI at `tongteo/agent`. External PRs are not a triage surface. See `docs/agents/issue-tracker.md`.

### Triage labels

All five canonical labels use their default names (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context — one `CONTEXT.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.

## Referenced Files

- Project instructions (Hermes): `/root/agent/.hermes.md`
- README: `/root/agent/nodejs/README.md`
- Package: `/root/agent/nodejs/package.json`
