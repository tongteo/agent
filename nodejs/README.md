# Agent CLI

AI agent chạy trong terminal. Hỗ trợ nhiều model: Gemini, Claude, OpenRouter, Ollama, Custom API.

## Cài đặt

```bash
cd nodejs
npm install
cp .env.example .env
```

## Cấu hình `.env`

Chọn một trong các provider:

| Provider | Biến cần set |
|---|---|
| Gemini Web (cookies) | `GEMINI_COOKIES=1` |
| Claude Web (cookies) | `CLAUDE_COOKIES=1` |
| OpenRouter | `OPENROUTER_API_KEY`, `OPENROUTER_MODEL` |
| Gemini API | `GEMINI_API_KEY` |
| Ollama | `OLLAMA_MODEL` |
| Custom API | `CUSTOM_API_BASE`, `CUSTOM_API_KEY`, `CUSTOM_MODEL` |

**Gemini/Claude Web** cần file cookies tại:
- `src/bridges/gemini_cookies.json`
- `src/bridges/claude_cookies.json`

## Chạy

```bash
node bin/openrouter          # agent mode (mặc định)
node bin/openrouter --chat   # chat mode
```

## Lệnh trong chat

| Lệnh | Mô tả |
|---|---|
| `exit` | Thoát |
| `clear` | Xoá lịch sử |
| `/model <tên>` | Đổi model |
| `/model <provider> <tên>` | Đổi provider |
| `/model list` | Liệt kê model Ollama |
| `/think` | Bật/tắt hiển thị thinking |
