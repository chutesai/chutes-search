#!/usr/bin/env python3
import sys, json, time
import urllib.request
import ssl

list_path = sys.argv[1] if len(sys.argv) > 1 else 'tmp/searxng_instances.txt'
working = []

# Permissive SSL context (public instances vary)
ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE

def fetch_json(url: str, timeout: int = 8):
    req = urllib.request.Request(url, headers={"User-Agent": "curl/8"})
    with urllib.request.urlopen(req, timeout=timeout, context=ctx) as resp:
        if resp.status != 200:
            return None
        raw = resp.read().decode('utf-8', errors='ignore')
        try:
            return json.loads(raw)
        except Exception:
            return None

with open(list_path, 'r') as f:
    for line in f:
        url = line.strip().rstrip('/')
        if not url:
            continue
        u = f"{url}/search?format=json&q=hello"
        t0 = time.time()
        try:
            data = fetch_json(u, timeout=8)
            ms = int((time.time() - t0)*1000)
            ok = isinstance(data, dict) and isinstance(data.get('results'), list)
            print(json.dumps({"url": url, "ok": ok, "ms": ms, "count": len(data.get('results', [])) if isinstance(data, dict) else 0}))
            if ok:
                working.append(url + '/')
        except Exception as e:
            ms = int((time.time() - t0)*1000)
            print(json.dumps({"url": url, "ok": False, "ms": ms, "error": str(e)}))

csv = ','.join(working)
print(csv)
