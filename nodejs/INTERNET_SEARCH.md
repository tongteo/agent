# Internet Search Skill

Tool tìm kiếm internet sử dụng unlimited.surf API.

## Cấu hình

Thêm vào `.env`:
```bash
# Dùng key từ ANTHROPIC_API_KEY hoặc đặt riêng
UNLIMITED_API_KEY=your-unlimited-surf-api-key
```

## Sử dụng

Agent tự động có tool `internet_search` với các tham số:

```json
{
  "query": "latest AI news this week",
  "model": "gateway-gemini-3-pro",
  "effort": "medium"
}
```

**Tham số:**
- `query` (bắt buộc): Câu hỏi tìm kiếm
- `model`: Model xử lý (mặc định: `gateway-gemini-3-pro`)
- `effort`: Mức độ tìm kiếm `low` | `medium` | `high` (mặc định: `medium`)

## Kết quả

Tool trả về:
1. Câu trả lời tóm tắt từ model
2. Danh sách nguồn với title + URL

## Cài đặt

```bash
npm install
```

## Test

Restart agent và hỏi:
```
Tìm tin tức AI mới nhất tuần này
```
