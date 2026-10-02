"""Build a self-contained, offline preview of the site from a running server.

Usage: python3 tools/build_demo.py http://localhost:8080 OUT_DIR
It snapshots the API (public + admin) and copies the web files and photos.
The preview runs entirely in the browser; admin edits are not saved.
"""
import json
import os
import shutil
import sys

import httpx

BASE, OUT = sys.argv[1].rstrip("/"), sys.argv[2]
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
pub = httpx.Client(base_url=BASE, timeout=30)
adm = httpx.Client(base_url=BASE, timeout=30, headers={"X-Mahina": "1"})
adm.post("/api/admin/login", json={"email": os.environ.get("ADMIN_EMAIL", "admin@example.com"),
                                   "password": os.environ.get("ADMIN_PASSWORD", "kalua-pig-at-the-beach-2026")}).raise_for_status()

data = {}


def grab(client, path):
    r = client.get(path)
    if r.status_code == 200:
        data[path] = r.json()
    return data.get(path)


site = grab(pub, "/api/site")
events = grab(pub, "/api/events")
for e in events:
    grab(pub, f"/api/events/{e['slug']}")
for s in grab(pub, "/api/sheets"):
    grab(pub, f"/api/sheets/{s['id']}")
for p in grab(pub, "/api/polls"):
    grab(pub, f"/api/polls/{p['slug']}")
grab(pub, "/api/photos")

for path in ["/api/admin/overview", "/api/admin/events", "/api/admin/sheets", "/api/admin/polls", "/api/admin/photos",
             "/api/admin/tags", "/api/admin/messages", "/api/admin/people", "/api/admin/outbox", "/api/admin/settings",
             "/api/admin/admins"]:
    grab(adm, path)
for e in data["/api/admin/events"]:
    grab(adm, f"/api/admin/events/{e['id']}")
for s in data["/api/admin/sheets"]:
    grab(adm, f"/api/admin/sheets/{s['id']}")
for p in data["/api/admin/polls"]:
    grab(adm, f"/api/admin/polls/{p['id']}")
data["/api/admin/state"] = {"setup": True, "admin": {"id": 1, "email": "admin@example.com", "name": "Kalani"},
                            "password_login": True, "sso": None, "min_password": 15}
data["/api/admin/admins"] = [{"id": 1, "email": "admin@example.com", "name": "Kalani", "created": "2026-09-01T09:00"}]
data["/api/admin/settings"]["smtp_ready"] = False
data["qr"] = pub.get("/api/donate/qr.svg").text


# ---------- write files ----------
if os.path.exists(OUT):
    shutil.rmtree(OUT)
shutil.copytree(os.path.join(ROOT, "web"), os.path.join(OUT, "static"), ignore=shutil.ignore_patterns("index.html"))
os.makedirs(os.path.join(OUT, "media"))
used = set()


def walk(x):
    if isinstance(x, dict):
        for v in x.values():
            walk(v)
    elif isinstance(x, list):
        for v in x:
            walk(v)
    elif isinstance(x, str) and x.startswith("/media/"):
        used.add(x[7:])


walk(data)
for f in used:
    src = os.path.join(ROOT, "data", "uploads", f)
    if os.path.exists(src):
        shutil.copy(src, os.path.join(OUT, "media", f))

with open(os.path.join(OUT, "static", "js", "demo-data.js"), "w") as fh:
    fh.write("window.MAHINA_DATA = " + json.dumps(data, ensure_ascii=True, separators=(",", ":")) + ";\n")
print(f"snapshot: {len(data)} endpoints, {len(used)} media files")

INDEX = """<title>Mahina Club</title>
<meta name="theme-color" content="#0F2340">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Public+Sans:ital,wght@0,400..900;1,400..900&display=swap">
<link rel="stylesheet" href="static/css/site.css">
<link rel="stylesheet" href="static/css/admin.css">
<style>:root { color-scheme: light; } body { background: #FFFFFF; font-size: 17px; }</style>
<div id="app"></div>
<script>window.MAHINA = { demo: true, memoryRouting: true, mediaBase: "." };</script>
<script src="static/js/demo-data.js"></script>
<script src="static/js/demo.js"></script>
<script type="module" src="static/js/app.js"></script>
"""
with open(os.path.join(OUT, "index.html"), "w") as fh:
    fh.write(INDEX)
