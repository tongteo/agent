#!/usr/bin/env python3
"""
Hướng dẫn xuất cookies từ Chrome/Firefox sang cookies.json.

Cách 1: Dùng extension "EditThisCookie" hoặc "Cookie-Editor"
  - Truy cập gemini.google.com đã đăng nhập
  - Export cookies dạng JSON → lưu vào cookies.json

Cách 2: Dùng script này với Chrome DevTools Protocol (cần Chrome đang chạy)
  Chạy Chrome với:  google-chrome --remote-debugging-port=9222
  Sau đó chạy:      python export_cookies.py
"""

import json
import sys
from playwright.sync_api import sync_playwright

OUTPUT = "cookies.json"


def export_from_running_chrome():
    """Kết nối Chrome đang chạy qua CDP và lấy cookies của gemini.google.com"""
    with sync_playwright() as p:
        try:
            browser = p.chromium.connect_over_cdp("http://localhost:9222")
        except Exception:
            print("[!] Không kết nối được Chrome tại localhost:9222")
            print("    Khởi động Chrome với: google-chrome --remote-debugging-port=9222")
            sys.exit(1)

        context = browser.contexts[0]
        cookies = context.cookies(["https://gemini.google.com",
                                   "https://accounts.google.com"])

        with open(OUTPUT, "w") as f:
            json.dump(cookies, f, indent=2)

        print(f"[✓] Đã lưu {len(cookies)} cookies vào {OUTPUT}")
        browser.close()


def interactive_login():
    """Mở browser có giao diện để tự đăng nhập, rồi lưu cookies."""
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=False)
        context = browser.new_context()
        page = context.new_page()
        page.goto("https://accounts.google.com")

        print("[*] Trình duyệt đã mở. Hãy đăng nhập Google rồi nhấn Enter ở đây...")
        input("    Nhấn Enter sau khi đăng nhập xong: ")

        cookies = context.cookies(["https://gemini.google.com",
                                   "https://accounts.google.com",
                                   "https://google.com"])
        with open(OUTPUT, "w") as f:
            json.dump(cookies, f, indent=2)

        print(f"[✓] Đã lưu {len(cookies)} cookies vào {OUTPUT}")
        browser.close()


if __name__ == "__main__":
    mode = sys.argv[1] if len(sys.argv) > 1 else "login"
    if mode == "cdp":
        export_from_running_chrome()
    else:
        interactive_login()
