#!/usr/bin/env python3
"""
Auto-refresh Gemini cookies.

Modes:
  python3 refresh_cookies.py check     — kiểm tra cookies còn hạn không
  python3 refresh_cookies.py fetch     — mở browser, hướng dẫn copy cookies
  python3 refresh_cookies.py auto      — check rồi fetch nếu hết hạn (default)
"""
import json, sys, os, re, subprocess, time, textwrap
from pathlib import Path
import urllib.request, urllib.error

COOKIES_FILE = Path(__file__).parent / "gemini_cookies.json"
APP_URL = "https://gemini.google.com/app"
CHECK_URL = "https://gemini.google.com/app"

# ── helpers ──────────────────────────────────────────────────────────────────

def load_cookies():
    if not COOKIES_FILE.exists():
        return {}
    data = json.loads(COOKIES_FILE.read_text())
    return {c["name"]: c["value"] for c in data}

def check_alive(cookies: dict) -> bool:
    """Return True nếu cookies còn hạn (SNlM0e token lấy được)."""
    try:
        import requests
        s = requests.Session()
        s.cookies.update(cookies)
        s.headers["User-Agent"] = (
            "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
            "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
        )
        s.headers["Referer"] = "https://gemini.google.com/"
        html = s.get(APP_URL, timeout=20).text
        return bool(re.search(r'"SNlM0e":"(.*?)"', html))
    except Exception as e:
        print(f"[!] Lỗi khi kiểm tra: {e}")
        return False

def open_browser(url: str):
    """Mở URL bằng bất kỳ browser nào có sẵn."""
    openers = [
        ["termux-open-url", url],
        ["xdg-open", url],
        ["am", "start", "-a", "android.intent.action.VIEW", "-d", url],
    ]
    for cmd in openers:
        try:
            subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            return True
        except FileNotFoundError:
            continue
    return False

# ── fetch mode: hướng dẫn user lấy cookies ───────────────────────────────────

EXTENSION_STORES = {
    "Cookie-Editor": "https://cookie-editor.com/",
    "EditThisCookie (Firefox)": "https://addons.mozilla.org/en-US/firefox/addon/edit-this-cookie2/",
}

BOOKMARKLET = (
    "javascript:(function(){"
    "var c=document.cookie.split('; ');"
    "var o=[];"
    "document.cookie.split('; ').forEach(function(p){"
    "var s=p.indexOf('=');"
    "o.push({name:p.slice(0,s),value:p.slice(s+1),domain:'.google.com',path:'/'});"
    "});"
    "prompt('Copy JSON:',JSON.stringify(o));"
    "})();"
)

def fetch_mode():
    print("\n📋 Hướng dẫn lấy Gemini cookies mới:\n")

    # Bước 1: mở Gemini
    print("Bước 1: Mở gemini.google.com và đảm bảo đã đăng nhập")
    opened = open_browser("https://gemini.google.com/app")
    if opened:
        print("        ✓ Đã mở browser tự động")
    else:
        print("        → Mở thủ công: https://gemini.google.com/app")

    print()
    print("Bước 2: Lấy cookies bằng một trong các cách sau:")
    print()
    print("  Cách A — Dùng extension Cookie-Editor (khuyên dùng):")
    print("    1. Cài extension: https://cookie-editor.com/")
    print("    2. Mở trang Gemini → click icon extension → Export → Copy JSON")
    print()
    print("  Cách B — Dùng DevTools (F12):")
    print("    1. Mở DevTools → Console")
    print("    2. Paste đoạn sau và Enter:")
    print()
    snippet = textwrap.dedent("""
        copy(JSON.stringify(
          document.cookie.split('; ').map(p => {
            const [name, ...v] = p.split('=');
            return {name, value: v.join('='), domain: '.google.com', path: '/'};
          })
        ))
    """).strip()
    for line in snippet.split('\n'):
        print(f"        {line}")
    print()
    print("    3. Dán (Ctrl+V) vào terminal bên dưới")
    print()

    # Bước 3: nhận JSON từ stdin
    print("Bước 3: Paste JSON cookies vào đây rồi nhấn Enter (hoặc nhấn Ctrl+D để bỏ qua):")
    print()
    lines = []
    try:
        while True:
            line = input()
            lines.append(line)
            # detect end khi JSON hợp lệ
            text = '\n'.join(lines).strip()
            if text.startswith('[') or text.startswith('{'):
                try:
                    json.loads(text)
                    break
                except json.JSONDecodeError:
                    pass
    except EOFError:
        print("\n[!] Đã bỏ qua.")
        return False

    raw = '\n'.join(lines).strip()

    # Normalize: nếu là dict thì bọc thành list
    try:
        data = json.loads(raw)
        if isinstance(data, dict):
            data = [data]
    except json.JSONDecodeError as e:
        print(f"[!] JSON không hợp lệ: {e}")
        return False

    # Normalize fields
    normalized = []
    for c in data:
        if "name" not in c or "value" not in c:
            continue
        normalized.append({
            "name": c["name"],
            "value": c["value"],
            "domain": c.get("domain", ".google.com"),
            "path": c.get("path", "/"),
            "secure": c.get("secure", True),
            "sameSite": c.get("sameSite", "None"),
        })

    if not normalized:
        print("[!] Không tìm thấy cookie hợp lệ.")
        return False

    # Kiểm tra trước khi lưu
    print(f"\n[*] Kiểm tra {len(normalized)} cookies...")
    test_dict = {c["name"]: c["value"] for c in normalized}
    if not check_alive(test_dict):
        print("[!] Cookies mới vẫn không hợp lệ. Hãy đảm bảo đã đăng nhập Gemini.")
        return False

    COOKIES_FILE.write_text(json.dumps(normalized, indent=2))
    print(f"[✓] Đã lưu {len(normalized)} cookies vào {COOKIES_FILE}")
    return True


# ── auto-refresh: kiểm tra định kỳ ───────────────────────────────────────────

def refresh_if_needed():
    """Dùng như wrapper: check → nếu hết thì fetch."""
    cookies = load_cookies()
    if not cookies:
        print("[!] Chưa có cookies.json")
        return fetch_mode()

    print("[*] Kiểm tra cookies...", end=" ", flush=True)
    if check_alive(cookies):
        print("✓ Còn hạn")
        return True
    else:
        print("✗ Hết hạn")
        return fetch_mode()


# ── main ─────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    mode = sys.argv[1] if len(sys.argv) > 1 else "auto"
    if mode == "check":
        cookies = load_cookies()
        alive = check_alive(cookies) if cookies else False
        print("✓ Cookies hợp lệ" if alive else "✗ Cookies hết hạn hoặc không tồn tại")
        sys.exit(0 if alive else 1)
    elif mode == "fetch":
        ok = fetch_mode()
        sys.exit(0 if ok else 1)
    else:  # auto
        ok = refresh_if_needed()
        sys.exit(0 if ok else 1)
