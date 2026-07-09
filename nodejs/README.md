# agent-cli

AI Agent chạy trong terminal — hỗ trợ tool integration, LSP code intelligence,
và Playwright-based web providers (Gemini Web, Claude Web).

## Tính năng

- **Agent mode**: Tự động gọi tools (đọc/ghi file, shell, search, LSP, subagent)
- **Chat mode**: Hội thoại trực tiếp với model
- **LSP Integration**: Go-to-definition, find references, diagnostics, rename symbol
- **Playwright bridges**: Kết nối Gemini Web và Claude Web qua CDP
- **Terminal UI đẹp**: Syntax highlighting Tokyo Night, markdown rendering, tab completion
- **Session persistence**: Lưu working directory và env vars
- **Context Window Management**: Tự động trim history khi gần tới token limit
- **KV Cache**: Cache response với TTL và LRU eviction
- **Security Validator**: Phát hiện lệnh nguy hiểm trước khi chạy
- **Full test suite**: 88+ unit tests

## Cài đặt

```bash
cd nodejs
npm install
# Copy và cấu hình .env
cp .env.example .env
```

## Sử dụng

**Lưu ý**: Agent cần X server để chạy Chromium. Nếu bạn đang ở môi trường headless (SSH, container), khởi động Xvfb trước:

```bash
# Khởi động Xvfb (chạy một lần, giữ background)
Xvfb :99 -screen 0 1280x720x24 -ac &

# Set DISPLAY
export DISPLAY=:99

# Chạy agent
npm start
```

Hoặc dùng `xvfb-run` wrapper:

```bash
xvfb-run -a npm start
```

### Cấu hình (.env)

| Biến | Mô tả |
|------|-------|
| `GEMINI_COOKIES=1` | Dùng Gemini Web (cần Chromium CDP) |
| `CLAUDE_COOKIES=1` | Dùng Claude Web (cần Chromium CDP) |
| `CDP_URL` | CDP endpoint (mặc định http://localhost:9222) |
| `AUTO_EXEC=true` | Tự động chạy lệnh không cần xác nhận |

## Kiến trúc

```
bin/openrouter              ← entry point
src/
├── chat-bot.js             ← main loop (451 dòng)
├── core/
│   ├── agent.js            ← prompts + tool/intent parser (263 dòng)
│   ├── context-manager.js  ← token counting + history trimming (MỚI)
│   ├── kv-cache.js         ← response cache với TTL (41 dòng)
│   ├── lsp.js              ← LSP client (224 dòng)
│   ├── message.js          ← message handler (54 dòng)
│   ├── session.js          ← session persistence (35 dòng)
│   ├── subagent.js         ← parallel task delegation (90 dòng)
│   ├── tools.js            ← re-export (3 dòng)
│   └── tools/              ← split từ tools.js gốc (791 → 4 modules)
│       ├── index.js        ← ToolRegistry chính (~150 dòng)
│       ├── utils.js        ← sanitize, quoting helpers (~100 dòng)
│       ├── file-ops.js     ← file operations tools (~260 dòng)
│       ├── lsp-tools.js    ← LSP tool wrappers (~170 dòng)
│       ├── misc-tools.js   ← execute/bash/git/search (~370 dòng)
│       └── subagent-tools.js ← subagent delegation (~40 dòng)
├── commands/
│   ├── executor.js         ← shell executor with cd/export (128 dòng)
│   ├── parser.js           ← command extraction (104 dòng)
│   └── validator.js        ← security validator (82 dòng)
├── ui/
│   ├── prompt.js           ← interactive prompt (229 dòng)
│   ├── formatter.js        ← markdown render (152 dòng)
│   └── diff.js             ← diff display (173 dòng)
├── models/
│   ├── gemini-cookies.js   ← Gemini web adapter (52 dòng)
│   └── claude-cookies.js   ← Claude web adapter (52 dòng)
└── bridges/
    ├── browser-manager.js  ← CDP connection pool (43 dòng)
    ├── gemini-client.js    ← Gemini Playwright driver (84 dòng)
    └── claude-client.js    ← Claude Playwright driver (83 dòng)
tests/
├── run.js                  ← test runner
├── test-context-manager.js ← 13 tests
├── test-intent-parser.js   ← 13 tests
├── test-kv-cache.js        ← 7 tests
├── test-parser.js          ← 17 tests
├── test-tool-parser.js     ← 8 tests
├── test-tools-utils.js     ← 15 tests
└── test-validator.js       ← 15 tests
```

## Chạy tests

```bash
npm test
# 88 tests, 0 failed
```

## Các vấn đề đã khắc phục

- **Split tools.js** (791 dòng → 6 modules nhỏ)
- **Thêm ContextManager** — token estimation + auto trim history
- **JSDoc annotations** cho toàn bộ source code
- **Security Validator** mở rộng — thêm patterns cho /dev, fork bomb, mkfs
- **Xoá artifact** `src/core/_patch1.ps1`
- **Thêm test suite** — 88 unit tests
- **Cập nhật package.json** — scripts: test, lint, doctor
