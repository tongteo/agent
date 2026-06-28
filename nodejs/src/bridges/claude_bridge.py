#!/usr/bin/env python3
"""Persistent bridge for Claude.ai web: reads JSON lines from stdin, writes JSON lines to stdout."""
import json, sys, uuid, time, requests, signal
from pathlib import Path

# Ignore SIGINT in bridge process (parent handles it)
signal.signal(signal.SIGINT, signal.SIG_IGN)

COOKIES_FILE = Path(__file__).parent / "claude_cookies.json"
BASE_URL = "https://claude.ai"
API_URL = f"{BASE_URL}/api"

HEADERS_BASE = {
    "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36",
    "Origin": BASE_URL,
    "Referer": f"{BASE_URL}/",
    "Accept": "text/event-stream, application/json",
    "Content-Type": "application/json",
    "anthropic-client-platform": "web_claude_ai",
}


def load_session():
    cookies = {c["name"]: c["value"] for c in json.loads(COOKIES_FILE.read_text())}
    s = requests.Session()
    s.cookies.update(cookies)
    s.headers.update({k: v for k, v in HEADERS_BASE.items() if k != "Content-Type"})

    # Get organization id
    r = s.get(f"{API_URL}/organizations", timeout=30)
    r.raise_for_status()
    orgs = r.json()
    if not orgs:
        raise RuntimeError("No organizations found — cookies may have expired")
    org_id = orgs[0]["uuid"]
    return s, org_id


def create_conversation(session, org_id):
    r = session.post(f"{API_URL}/organizations/{org_id}/chat_conversations",
                     json={"uuid": str(uuid.uuid4()), "name": ""},
                     headers={"Content-Type": "application/json"},
                     timeout=30)
    r.raise_for_status()
    return r.json()["uuid"]


def send_message(session, org_id, conv_id, text):
    payload = {
        "prompt": text,
        "attachments": [],
        "files": [],
    }
    r = session.post(
        f"{API_URL}/organizations/{org_id}/chat_conversations/{conv_id}/completion",
        json=payload,
        headers={"Content-Type": "application/json", "Accept": "text/event-stream"},
        stream=True,
        timeout=360,
    )
    r.raise_for_status()

    full_text = ""
    for line in r.iter_lines():
        if not line:
            continue
        line = line.decode("utf-8") if isinstance(line, bytes) else line
        if not line.startswith("data:"):
            continue
        data = line[5:].strip()
        if not data or data == "[DONE]":
            continue
        try:
            evt = json.loads(data)
            t = evt.get("type", "")
            if t == "completion":
                full_text += evt.get("completion", "")
            elif t == "content_block_delta":
                full_text += evt.get("delta", {}).get("text", "")
            elif t == "error":
                raise RuntimeError(evt.get("error", {}).get("message", "Unknown error"))
        except json.JSONDecodeError:
            continue

    if not full_text:
        raise RuntimeError("Empty response — cookies may have expired")
    return full_text


def main():
    sys.stderr.write("[bridge] starting...\n"); sys.stderr.flush()
    session, org_id = load_session()
    conv_id = None
    sys.stderr.write("[bridge] ready\n"); sys.stderr.flush()
    print(json.dumps({"ready": True}), flush=True)

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            payload = json.loads(line)
            text = payload["text"]
            # Use existing conv or create new
            if not conv_id or payload.get("new_conv"):
                conv_id = create_conversation(session, org_id)

            result_text = send_message(session, org_id, conv_id, text)
            print(json.dumps({"text": result_text, "conv_id": conv_id}), flush=True)
        except RuntimeError as e:
            err = str(e)
            if "expired" in err.lower():
                sys.stderr.write("[bridge] session expired, reloading...\n"); sys.stderr.flush()
                try:
                    session, org_id = load_session()
                    conv_id = create_conversation(session, org_id)
                    result_text = send_message(session, org_id, conv_id, text)
                    print(json.dumps({"text": result_text, "conv_id": conv_id}), flush=True)
                except Exception as e2:
                    print(json.dumps({"error": str(e2)}), flush=True)
            else:
                print(json.dumps({"error": err}), flush=True)
        except Exception as e:
            print(json.dumps({"error": str(e)}), flush=True)


if __name__ == "__main__":
    main()
