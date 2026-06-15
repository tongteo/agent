#!/usr/bin/env python3
"""Persistent bridge: reads JSON lines from stdin, writes JSON lines to stdout."""
import json, re, sys, uuid, time, requests
from pathlib import Path

COOKIES_FILE = Path(__file__).parent / "gemini_cookies.json"
APP_URL = "https://gemini.google.com/app"
ENDPOINT = ("https://gemini.google.com/_/BardChatUi/data/"
            "assistant.lamda.BardFrontendService/StreamGenerate")

HEADERS_BASE = {
    "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36",
    "Origin": "https://gemini.google.com",
    "Referer": "https://gemini.google.com/",
    "Content-Type": "application/x-www-form-urlencoded;charset=utf-8",
    "X-Same-Domain": "1",
}


def load_session():
    cookies = {c["name"]: c["value"] for c in json.loads(COOKIES_FILE.read_text())}
    s = requests.Session()
    s.cookies.update(cookies)
    s.headers.update({"User-Agent": HEADERS_BASE["User-Agent"]})
    html = s.get(APP_URL, timeout=30).text
    m = re.search(r'"SNlM0e":"(.*?)"', html)
    if not m:
        raise RuntimeError("No SNlM0e — cookies may have expired")
    bl_match = re.search(r'"cfb2h":"(.*?)"', html)
    bl = bl_match.group(1) if bl_match else ""
    sid_match = re.search(r'"FdrFJe":"(-?\d+)"', html)
    sid = sid_match.group(1) if sid_match else ""
    return s, m.group(1), bl, sid


def build_request(text, metadata):
    req = [None] * 69
    req[0] = [text, 0, None, None, None, None, 0]
    req[1] = ["en"]
    req[2] = metadata
    req[6] = [1]
    req[7] = 1
    req[10] = 1
    req[11] = 0
    req[17] = [[0]]
    req[18] = 0
    req[27] = 1
    req[30] = [4]
    req[41] = [1]
    req[53] = 0
    req[61] = []
    req[68] = 2
    uid = str(uuid.uuid4()).upper()
    req[59] = uid
    return req, uid


def parse_response(raw):
    best = None
    for line in raw.splitlines():
        try:
            outer = json.loads(line)
            if not isinstance(outer, list):
                continue
            for item in outer:
                if not (isinstance(item, list) and len(item) >= 3 and item[0] == "wrb.fr"):
                    continue
                # Check for error codes
                if len(item) > 5 and item[5]:
                    err_container = item[5]
                    if isinstance(err_container, list):
                        # Flatten search for error code pattern
                        raw_str = json.dumps(err_container)
                        import re as _re
                        codes = _re.findall(r'\[(\d{4})\]', raw_str)
                        if codes:
                            raise RuntimeError(f"API error code: {codes[0]}")
                if not item[2]:
                    continue
                d = json.loads(item[2])
                if d and len(d) > 4 and d[4] and d[4][0] and len(d[4][0]) > 1 and d[4][0][1]:
                    best = {
                        "text": d[4][0][1][0],
                        "conv_id": d[1][0] if d[1] else "",
                        "resp_id": d[1][1] if d[1] and len(d[1]) > 1 else "",
                        "choice_id": d[4][0][0],
                    }
        except RuntimeError:
            raise
        except (json.JSONDecodeError, IndexError, KeyError, TypeError):
            continue
    if best is None:
        sys.stderr.write(f"[bridge] parse failed, snippet: {raw[:300]}\n")
        raise RuntimeError("Could not parse response — cookies may have expired")
    return best


def do_request(session, snlm0e, bl, sid, text, metadata):
    req, uid = build_request(text, metadata)
    params = {"hl": "en", "_reqid": "100000", "rt": "c"}
    if bl:
        params["bl"] = bl
    if sid:
        params["f.sid"] = sid
    headers = {
        **HEADERS_BASE,
        "x-goog-ext-525001261-jspb": "[1,null,null,null,null,null,null,null,[4]]",
        "x-goog-ext-73010989-jspb": "[0]",
        "x-goog-ext-73010990-jspb": "[0]",
        "x-goog-ext-525005358-jspb": f'["{uid}",1]',
    }
    r = session.post(ENDPOINT, params=params, headers=headers,
        data={"at": snlm0e, "f.req": json.dumps([None, json.dumps(req)])}, timeout=60)
    r.raise_for_status()
    return r.text


def do_request_with_retry(session, snlm0e, bl, sid, text, metadata, retries=5):
    for attempt in range(retries):
        raw = do_request(session, snlm0e, bl, sid, text, metadata)
        try:
            return parse_response(raw)
        except RuntimeError as e:
            err = str(e)
            if "1095" in err or "1060" in err or "1097" in err:
                if attempt < retries - 1:
                    wait = 20 * (attempt + 1)
                    sys.stderr.write(f"[bridge] rate limited ({err}), waiting {wait}s...\n")
                    sys.stderr.flush()
                    time.sleep(wait)
                    continue
            raise
    raise RuntimeError("Max retries exceeded")


def reload_session_with_refresh():
    try:
        return load_session()
    except RuntimeError as e:
        if "expired" in str(e).lower() or "snlm0e" in str(e).lower():
            if not sys.stdin.isatty():
                raise RuntimeError("Cookies expired. Run: python3 ~/gemini/refresh_cookies.py fetch")
            sys.stderr.write("[bridge] cookies expired — running refresh_cookies.py...\n")
            sys.stderr.flush()
            import subprocess
            refresh = Path(__file__).parent / "refresh_cookies.py"
            result = subprocess.run(["python3", str(refresh), "auto"], timeout=300)
            if result.returncode == 0:
                return load_session()
        raise


def main():
    sys.stderr.write("[bridge] starting...\n"); sys.stderr.flush()
    session, snlm0e, bl, sid = reload_session_with_refresh()
    sys.stderr.write("[bridge] ready\n"); sys.stderr.flush()
    print(json.dumps({"ready": True}), flush=True)

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        text = conv_id = resp_id = choice_id = ""
        try:
            payload = json.loads(line)
            text = payload["text"]
            conv_id = payload.get("conv_id", "")
            resp_id = payload.get("resp_id", "")
            choice_id = payload.get("choice_id", "")
            metadata = [conv_id, resp_id, choice_id, None, None, None, None, None, None, ""]

            result = do_request_with_retry(session, snlm0e, bl, sid, text, metadata)
            print(json.dumps(result), flush=True)
        except RuntimeError as e:
            err = str(e)
            if ("expired" in err.lower() or "SNlM0e" in err) and "1095" not in err and "1097" not in err:
                sys.stderr.write("[bridge] session expired, reloading...\n"); sys.stderr.flush()
                try:
                    session, snlm0e, bl, sid = reload_session_with_refresh()
                    metadata = [conv_id, resp_id, choice_id, None, None, None, None, None, None, ""]
                    result = do_request_with_retry(session, snlm0e, bl, sid, text, metadata)
                    print(json.dumps(result), flush=True)
                except Exception as e2:
                    print(json.dumps({"error": str(e2)}), flush=True)
            else:
                print(json.dumps({"error": err}), flush=True)
        except Exception as e:
            print(json.dumps({"error": str(e)}), flush=True)


if __name__ == "__main__":
    main()
