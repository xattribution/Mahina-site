"""Mahina Club web app: public API, static site, calendar feed."""
import io
import json
import os
import time
from collections import defaultdict, deque

import segno
from fastapi import Body, FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles

from . import db, mailer, media, store
from .admin import router as admin_router
from .store import Invalid

WEB_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "web")

app = FastAPI(title="Mahina Club", docs_url=None, redoc_url=None, openapi_url=None)
db.init()

UPLOAD_PATHS = ("/api/photos/submit", "/api/admin/photos", "/api/admin/settings/cover")
CSP = ("default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
       "font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self'; "
       "frame-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self' https:; frame-ancestors 'none'")


class Guard:
    """Caps request bodies (1 MB for forms, 200 MB for photo uploads) and adds security headers."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        path = scope.get("path", "")
        limit = 200 * 1024 * 1024 if path.startswith(UPLOAD_PATHS) else 1024 * 1024
        headers = dict(scope.get("headers") or [])
        https = scope.get("scheme") == "https" or headers.get(b"x-forwarded-proto") == b"https"
        try:
            if int(headers.get(b"content-length", b"0")) > limit:
                return await self._too_big(send)
        except ValueError:
            pass
        seen = 0

        async def limited_receive():
            nonlocal seen
            msg = await receive()
            if msg["type"] == "http.request":
                seen += len(msg.get("body", b""))
                if seen > limit:
                    raise Invalid("That upload is too large.", status=413)
            return msg

        async def send_with_headers(msg):
            if msg["type"] == "http.response.start":
                h = list(msg.get("headers", []))
                h += [(b"x-content-type-options", b"nosniff"), (b"referrer-policy", b"strict-origin-when-cross-origin"),
                      (b"x-frame-options", b"DENY"), (b"permissions-policy", b"camera=(), microphone=(), geolocation=()"),
                      (b"cross-origin-opener-policy", b"same-origin"), (b"content-security-policy", CSP.encode())]
                if https:
                    h.append((b"strict-transport-security", b"max-age=31536000"))
                if path.startswith("/api/"):
                    h.append((b"cache-control", b"no-store"))
                msg["headers"] = h
            await send(msg)

        await self.app(scope, limited_receive, send_with_headers)

    @staticmethod
    async def _too_big(send):
        await send({"type": "http.response.start", "status": 413, "headers": [(b"content-type", b"application/json")]})
        await send({"type": "http.response.body", "body": b'{"error":"That upload is too large."}'})


from starlette.middleware.sessions import SessionMiddleware  # noqa: E402  (holds single sign-on state only)
from . import auth as _auth  # noqa: E402

app.add_middleware(SessionMiddleware, secret_key=_auth.secret_key(), session_cookie="mc_sso", max_age=600,
                   same_site="lax", https_only=os.environ.get("SITE_URL", "").startswith("https://"))
app.add_middleware(Guard)


@app.on_event("startup")
def startup():
    db.init()
    if os.environ.get("MAHINA_SEED") == "1" and not db.one("SELECT id FROM events LIMIT 1"):
        from . import seed
        seed.run()
    from . import admin
    admin.bootstrap_admin()
    if os.environ.get("MAHINA_NO_WORKER") != "1":
        mailer.worker()


@app.exception_handler(Invalid)
def invalid_handler(request, exc: Invalid):
    return JSONResponse({"error": exc.message, "field": exc.field}, status_code=exc.status)


# ---------- light abuse protection for public forms ----------

_hits = defaultdict(deque)


def throttle(request: Request, bucket: str, limit=12, window=300):
    ip = request.client.host if request.client else "?"  # proxy-resolved by uvicorn for trusted proxies only
    dq, now = _hits[(bucket, ip)], time.time()
    while dq and dq[0] < now - window:
        dq.popleft()
    if len(dq) >= limit:
        raise Invalid("Too many tries. Wait a few minutes and try again.", status=429)
    dq.append(now)


def honeypot(body):
    if (body or {}).get("website"):
        raise Invalid("Couldn't submit that form.")


# ---------- site ----------

@app.get("/healthz")
def healthz():
    db.one("SELECT 1 AS ok")
    return {"ok": True}


@app.get("/api/site")
def site():
    s = db.all_settings()
    spot = s.get("spotlight") or {}
    return {
        "club_name": s["club_name"], "accent": s.get("accent") or "", "palette": s.get("palette") or "classic",
        "moon_caption": bool(s.get("moon_caption")), "org_line": s["org_line"], "email": s["email"], "timezone": s["timezone"],
        "venmo": s["venmo"], "donate_goal": s["donate_goal"], "donate_uses": s["donate_uses"],
        "banner": s["banner"] or {},
        "officers": s["officers"], "public_uploads": s["public_uploads"], "disclaimer": s["disclaimer"],
        "home_sections": s["home_sections"], "labels": {**db.DEFAULT_SETTINGS["labels"], **(s.get("labels") or {})},
        "spotlight": spot, "tags": store.all_tags(),
        "polls_open": db.one("SELECT COUNT(*) n FROM polls WHERE status='open' AND (closes_at IS NULL OR closes_at > ?)",
                             (db.now_iso(),))["n"],
    }


# ---------- events ----------

@app.get("/api/events")
def events(start: str = "", end: str = ""):
    start = start or "0000"
    end = end or "9999"
    rows = db.q("SELECT * FROM events WHERE status IN ('published','cancelled') AND starts_at >= ? AND starts_at <= ? "
                "ORDER BY starts_at", (start, end))
    return store.events_out(rows)


def get_event(slug):
    ev = db.one("SELECT * FROM events WHERE slug=? AND status IN ('published','cancelled')", (slug,))
    if not ev:
        raise Invalid("We couldn't find that event.", status=404)
    return ev


@app.get("/api/events/{slug}")
def event(slug: str):
    ev = get_event(slug)
    out = store.event_detail(ev)
    photos = db.q("SELECT * FROM photos WHERE event_id=? AND status='approved' ORDER BY id DESC LIMIT 12", (ev["id"],))
    out["gallery"] = [store.photo_out(p) for p in photos]
    return out


@app.post("/api/events/{slug}/rsvp")
def event_rsvp(slug: str, request: Request, body: dict = Body(...)):
    honeypot(body)
    throttle(request, "rsvp", 20)
    return store.rsvp(get_event(slug), body)


@app.get("/api/events/{slug}/calendar.ics")
def event_ics(slug: str):
    ev = get_event(slug)
    return Response(mailer.ics_for([ev]), media_type="text/calendar",
                    headers={"Content-Disposition": f'attachment; filename="{slug}.ics"'})


@app.get("/calendar.ics")
def feed():
    rows = db.q("SELECT * FROM events WHERE status IN ('published','cancelled') ORDER BY starts_at")
    return Response(mailer.ics_for(rows, db.get_setting("club_name")), media_type="text/calendar")


# ---------- sign-up sheets ----------

@app.get("/api/sheets")
def sheets():
    rows = db.q("""SELECT sh.* FROM sheets sh LEFT JOIN events e ON e.id=sh.event_id
                   WHERE sh.status='open' AND (sh.closes_at IS NULL OR sh.closes_at > ?)
                   AND (e.id IS NULL OR (e.status='published' AND e.starts_at > ?))
                   ORDER BY COALESCE(e.starts_at, sh.closes_at, '9999'), sh.sort""", (db.now_iso(), db.now_iso()))
    return [store.sheet_out(s) for s in rows]


@app.get("/api/sheets/{sid}")
def sheet(sid: int):
    s = db.one("SELECT * FROM sheets WHERE id=? AND status!='hidden'", (sid,))
    if not s:
        raise Invalid("We couldn't find that sign-up.", status=404)
    return store.sheet_out(s)


@app.post("/api/slots/{slot_id}/signup")
def slot_signup(slot_id: int, request: Request, body: dict = Body(...)):
    honeypot(body)
    throttle(request, "signup", 30)
    return store.signup(slot_id, body)


# ---------- manage my sign-ups ----------

def email_for_token(tok):
    for t in ("rsvps", "signups"):
        r = db.one(f"SELECT email FROM {t} WHERE token=?", (tok,))
        if r:
            return r["email"].lower()
    raise Invalid("This link has expired or was already used.", status=404)


@app.get("/api/me/{tok}")
def me(tok: str):
    email = email_for_token(tok)
    now = db.now_iso()
    rs = db.q("""SELECT r.id, r.status, r.guests, r.name, e.slug, e.title, e.starts_at, e.location FROM rsvps r
                 JOIN events e ON e.id=r.event_id WHERE lower(r.email)=? AND e.starts_at > ? ORDER BY e.starts_at""",
              (email, now))
    sg = db.q("""SELECT sg.id, sg.qty, sg.item, sg.name, sl.title slot, sl.starts_at slot_start, sh.title sheet,
                 e.slug, e.title event, e.starts_at FROM signups sg JOIN slots sl ON sl.id=sg.slot_id
                 JOIN sheets sh ON sh.id=sl.sheet_id LEFT JOIN events e ON e.id=sh.event_id
                 WHERE lower(sg.email)=? AND (e.id IS NULL OR e.starts_at > ?) ORDER BY COALESCE(e.starts_at, sl.starts_at)""",
              (email, now))
    sub = db.one("SELECT active FROM subscribers WHERE email=?", (email,))
    name = (rs[0]["name"] if rs else sg[0]["name"] if sg else "")
    return {"email": email, "name": name, "rsvps": rs, "signups": sg, "subscribed": bool(sub and sub["active"])}


@app.post("/api/me/{tok}/cancel")
def me_cancel(tok: str, body: dict = Body(...)):
    email = email_for_token(tok)
    kind, rid = body.get("kind"), int(body.get("id") or 0)
    if kind == "rsvp":
        db.run("UPDATE rsvps SET status='no' WHERE id=? AND lower(email)=?", (rid, email))
    elif kind == "signup":
        db.run("DELETE FROM signups WHERE id=? AND lower(email)=?", (rid, email))
    else:
        raise Invalid("Nothing to cancel.")
    return {"ok": True}


# ---------- polls ----------

@app.get("/api/polls")
def polls():
    rows = db.q("SELECT * FROM polls WHERE status IN ('open','closed') ORDER BY status='closed', created DESC")
    return [store.poll_out(p, with_questions=False) for p in rows]


def get_poll(slug):
    p = db.one("SELECT * FROM polls WHERE slug=? AND status!='draft'", (slug,))
    if not p:
        raise Invalid("We couldn't find that poll.", status=404)
    return p


@app.get("/api/polls/{slug}")
def poll(slug: str):
    p = get_poll(slug)
    out = store.poll_out(p)
    if p["results"] == "public" or (p["results"] == "after" and out["closed"]):
        out["tally"] = store.poll_results(p)
    return out


@app.post("/api/polls/{slug}/respond")
def poll_respond(slug: str, request: Request, body: dict = Body(...)):
    honeypot(body)
    throttle(request, "poll", 20)
    p = get_poll(slug)
    res = store.respond(p, body)
    if p["results"] in ("public", "after"):
        res["tally"] = store.poll_results(p)
    return res


# ---------- gallery ----------

@app.get("/api/photos")
def photos():
    rows = db.q("SELECT * FROM photos WHERE status='approved' ORDER BY created DESC, id DESC")
    tags = store.tags_for("photo_tags", "photo_id", [r["id"] for r in rows])
    evs = {e["id"]: e for e in db.q("SELECT id, slug, title, starts_at FROM events")}
    out = []
    for r in rows:
        p = store.photo_out(r)
        p["tags"] = tags.get(r["id"], [])
        p["event"] = evs.get(r["event_id"])
        out.append(p)
    return out


@app.post("/api/photos/submit")
async def submit_photos(request: Request, name: str = Form(""), email: str = Form(""), event_id: str = Form(""),
                        website: str = Form(""), files: list[UploadFile] = File(...)):
    if website:
        raise Invalid("Couldn't submit that form.")
    if not db.get_setting("public_uploads"):
        raise Invalid("Photo sharing is turned off.", status=403)
    throttle(request, "photos", 6, 600)
    store.need_name(name)
    if len(files) > 20:
        raise Invalid("Share up to 20 photos at a time.")
    ev = int(event_id) if event_id.isdigit() else None
    n = 0
    for f in files:
        data = await f.read()
        if len(data) > 25 * 1024 * 1024:
            raise Invalid(f"{f.filename} is over 25 MB.")
        try:
            fn, th, w, h = media.save_image(data)
        except ValueError as e:
            raise Invalid(f"{f.filename}: {e}")
        pid = db.run("INSERT INTO photos(file, thumb, w, h, event_id, status, submitted_by, created) VALUES (?,?,?,?,?,?,?,?)",
                     (fn, th, w, h, ev, "pending", f"{store.clean(name, 80)} <{store.clean(email, 120)}>", db.now_iso()))
        if ev:
            for t in db.q("SELECT tag_id FROM event_tags WHERE event_id=?", (ev,)):
                db.run("INSERT OR IGNORE INTO photo_tags(photo_id, tag_id) VALUES (?,?)", (pid, t["tag_id"]))
        n += 1
    return {"received": n}


# ---------- contact, list, donate ----------

@app.post("/api/contact")
def contact(request: Request, body: dict = Body(...)):
    honeypot(body)
    throttle(request, "contact", 5, 600)
    name, email = store.need_name(body.get("name")), store.need_email(body.get("email"))
    text = store.clean(body.get("message"), 5000, multiline=True)
    if len(text) < 2:
        raise Invalid("Write a message.", "message")
    subject = store.clean(body.get("subject"), 150)
    db.run("INSERT INTO messages(name, email, subject, body, created) VALUES (?,?,?,?,?)",
           (name, email, subject, text, db.now_iso()))
    club_email = db.get_setting("email")
    if club_email:
        h, t = mailer.render(f"New message from {name}", [("rows", [("From", f"{name} <{email}>"), ("Subject", subject)]), text],
                             button=("Open inbox", f"{mailer.site_url()}/admin/messages"))
        mailer.queue(club_email, f"Contact: {subject or name}", h, t, kind="contact")
    if body.get("subscribe"):
        store.subscribe(email, name, "contact")
    return {"ok": True}


@app.post("/api/subscribe")
def subscribe(request: Request, body: dict = Body(...)):
    honeypot(body)
    throttle(request, "subscribe", 8)
    store.subscribe(body.get("email"), body.get("name", ""), body.get("source", "site"))
    return {"ok": True}


def plain_page(title, body):
    """A tiny standalone page for links that open from email."""
    pal = db.palette_colors()
    return HTMLResponse(f"""<!doctype html><html lang=en><meta charset=utf-8><meta name=viewport content="width=device-width">
<title>{title}</title><meta name=robots content=noindex>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:520px;margin:14vh auto;padding:0 20px;
color:{pal['text']};line-height:1.55">{body}<p style="margin-top:32px"><a href="/" style="color:{pal['ink']}">Back to the site</a></p>""",
                        headers={"Cache-Control": "no-store", "Referrer-Policy": "no-referrer"})


def _btn(pal):
    return (f"font:inherit;font-weight:650;padding:12px 20px;border-radius:999px;border:0;cursor:pointer;"
            f"background:{pal['accent']};color:#fff")


@app.get("/unsubscribe/{tok}", response_class=HTMLResponse)
def unsubscribe(tok: str):
    r = db.one("SELECT * FROM subscribers WHERE token=?", (tok,))
    if not r:
        return plain_page("Not found", "<h1 style='letter-spacing:-.02em'>This link no longer works.</h1>"
                          "<p>You may have already removed yourself. You won't get club emails.</p>")
    db.run("UPDATE subscribers SET active=0 WHERE id=?", (r["id"],))
    pal = db.palette_colors()
    return plain_page("Unsubscribed", f"""<h1 style="letter-spacing:-.02em;color:{pal['ink']}">You're off the list.</h1>
<p>You won't get club emails anymore. Sign-up confirmations and reminders for things you join still arrive.</p>
<form method=post action="/unsubscribe/{tok}/remove" style="margin-top:36px;padding-top:24px;border-top:1px solid #ddd">
<p style="margin:0 0 14px"><b style="color:{pal['ink']}">Remove me completely</b><br>Deletes your name and email from the club's
records: the mailing list, RSVPs, sign-ups, and messages you sent.</p>
<button style="{_btn(pal)}">Remove me</button></form>""")


@app.post("/unsubscribe/{tok}/remove", response_class=HTMLResponse)
def unsubscribe_remove(tok: str, request: Request):
    throttle(request, "forget", 10)
    r = db.one("SELECT email FROM subscribers WHERE token=?", (tok,))
    if r:
        store.forget(r["email"])
        from .admin import audit
        audit(None, "A person removed themselves with their email link", ip="")
    return plain_page("Removed", "<h1 style='letter-spacing:-.02em'>You're removed.</h1>"
                      "<p>Your name and email are deleted from the club's records.</p>")


@app.post("/api/me/{tok}/remove")
def me_remove(tok: str, request: Request):
    throttle(request, "forget", 10)
    store.forget(email_for_token(tok))
    from .admin import audit
    audit(None, "A person removed themselves with their sign-up link", ip="")
    return {"ok": True}


@app.get("/api/donate/qr.svg")
def venmo_qr():
    handle = (db.get_setting("venmo") or "").lstrip("@")
    if not handle:
        raise HTTPException(404)
    qr = segno.make(f"https://venmo.com/u/{handle}", error="m")
    buf = io.BytesIO()
    qr.save(buf, kind="svg", scale=8, border=0, dark="#0F2340", light=None, xmldecl=False)
    svg = buf.getvalue().decode()
    size = qr.symbol_size(scale=8, border=0)[0]
    svg = svg.replace("<svg ", f'<svg viewBox="0 0 {size} {size}" ', 1)
    return Response(svg, media_type="image/svg+xml",
                    headers={"Cache-Control": "max-age=300"})


# ---------- admin, media, SPA ----------

app.include_router(admin_router)


@app.get("/media/{name}")
def media_file(name: str):
    path = os.path.join(db.UPLOAD_DIR, os.path.basename(name))
    if not os.path.isfile(path):
        raise HTTPException(404)
    return FileResponse(path, headers={"Cache-Control": "public, max-age=31536000, immutable"})


app.mount("/static", StaticFiles(directory=WEB_DIR), name="static")


@app.get("/{path:path}", response_class=HTMLResponse)
def spa(path: str):
    if path.startswith("api/"):
        raise HTTPException(404)
    return FileResponse(os.path.join(WEB_DIR, "index.html"), headers={"Cache-Control": "no-cache"})
