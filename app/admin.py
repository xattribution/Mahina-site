"""Admin API: sign-in, content management, email, settings."""
import csv
import io
import json
import os
import secrets
import time
from datetime import datetime, timedelta

from fastapi import APIRouter, Body, Depends, File, Form, Request, Response, UploadFile
from fastapi.responses import StreamingResponse

from . import auth, db, mailer, media, store
from .store import Invalid, clean

router = APIRouter(prefix="/api/admin")
COOKIE = "mc_session"


def client_ip(request: Request):
    # uvicorn already resolves X-Forwarded-For when the proxy is trusted (FORWARDED_ALLOW_IPS)
    return request.client.host if request.client else "?"


def bootstrap_admin():
    email, pw = (os.environ.get("ADMIN_EMAIL") or "").lower(), os.environ.get("ADMIN_PASSWORD")
    if not email or db.one("SELECT id FROM admins WHERE email=?", (email,)):
        return
    if pw:
        try:
            auth.check_new_password(pw, email=email)
        except Invalid as e:
            print(f"ADMIN_PASSWORD rejected: {e.message} The first admin was not created.")
            return
    db.run("INSERT INTO admins(email, name, pw_hash, created) VALUES (?,?,?,?)",
           (email, os.environ.get("ADMIN_NAME", "Admin"), auth.hash_password(pw) if pw else "", db.now_iso()))


def current_admin(request: Request):
    s = auth.session_admin(request.cookies.get(COOKIE))
    if s:
        if request.method not in ("GET", "HEAD") and request.headers.get("x-mahina") != "1":
            raise Invalid("Blocked a cross-site request.", status=403)
        return s
    raise Invalid("Sign in to continue.", status=401)


Admin = Depends(current_admin)


def is_https(request: Request):
    return request.url.scheme == "https" or request.headers.get("x-forwarded-proto") == "https"


def start_session(response: Response, admin_id, request: Request):
    tok = auth.create_session(admin_id)
    response.set_cookie(COOKIE, tok, max_age=auth.SESSION_DAYS * 86400, httponly=True, samesite="strict",
                        secure=is_https(request), path="/")


@router.get("/state")
def state(request: Request):
    has_admin = bool(db.one("SELECT id FROM admins LIMIT 1"))
    oidc = auth.oidc_config()
    out = {"setup": has_admin, "admin": None, "password_login": auth.password_login_enabled(),
           "sso": {"name": oidc["name"]} if oidc else None, "min_password": auth.MIN_LEN}
    s = auth.session_admin(request.cookies.get(COOKIE))
    if s:
        out["admin"] = {"id": s["id"], "email": s["email"], "name": s["name"]}
    return out


@router.post("/setup")
def setup(request: Request, response: Response, body: dict = Body(...)):
    if db.one("SELECT id FROM admins LIMIT 1"):
        raise Invalid("Setup is already done. Sign in instead.", status=403)
    name, email = store.need_name(body.get("name")), store.need_email(body.get("email"))
    pw = auth.check_new_password(body.get("password") or "", email=email, name=name)
    aid = db.run("INSERT INTO admins(email, name, pw_hash, created) VALUES (?,?,?,?)",
                 (email, name, auth.hash_password(pw), db.now_iso()))
    start_session(response, aid, request)
    return {"ok": True}


@router.post("/login")
def login(request: Request, response: Response, body: dict = Body(...)):
    if not auth.password_login_enabled():
        raise Invalid("Password sign-in is off. Use single sign-on.", status=403)
    email, ip = clean(body.get("email"), 200).lower(), client_ip(request)
    auth.check_throttle(email, ip)
    a = db.one("SELECT * FROM admins WHERE email=?", (email,))
    ok, rehash = auth.verify_password(body.get("password") or "", a["pw_hash"] if a else None)
    if not ok:
        auth.record_failure(email, ip)
        raise Invalid("That email and password don't match.", status=401)
    auth.clear_failures(email)
    if rehash:
        db.run("UPDATE admins SET pw_hash=? WHERE id=?", (rehash, a["id"]))
    start_session(response, a["id"], request)
    return {"ok": True}


@router.post("/logout")
def logout(request: Request, response: Response):
    auth.end_session(request.cookies.get(COOKIE))
    response.delete_cookie(COOKIE, path="/")
    return {"ok": True}


# ---------- single sign-on ----------

_oauth = None


def oauth_client():
    global _oauth
    cfg = auth.oidc_config()
    if not cfg:
        raise Invalid("Single sign-on isn't set up.", status=404)
    if _oauth is None:
        from authlib.integrations.starlette_client import OAuth
        _oauth = OAuth()
        _oauth.register("sso", client_id=cfg["client_id"], client_secret=cfg["client_secret"],
                        server_metadata_url=cfg["metadata"], client_kwargs={"scope": "openid email profile",
                                                                            "code_challenge_method": "S256"})
    return _oauth.sso


@router.get("/sso/start")
async def sso_start(request: Request):
    client = oauth_client()
    return await client.authorize_redirect(request, f"{mailer.site_url()}/api/admin/sso/callback")


@router.get("/sso/callback")
async def sso_callback(request: Request):
    from fastapi.responses import RedirectResponse
    client = oauth_client()
    fail = lambda why: RedirectResponse(f"/admin?sso_error={why}", status_code=303)
    try:
        token = await client.authorize_access_token(request)
    except Exception:
        return fail("failed")
    info = token.get("userinfo") or {}
    email = (info.get("email") or "").lower()
    if not email or info.get("email_verified") is False:
        return fail("noemail")
    a = db.one("SELECT * FROM admins WHERE email=?", (email,))
    if not a:
        return fail("notadmin")
    resp = RedirectResponse("/admin", status_code=303)
    start_session(resp, a["id"], request)
    return resp


# ---------- overview ----------

@router.get("/overview")
def overview(a=Admin):
    now = db.now_iso()
    upcoming = db.q("SELECT * FROM events WHERE starts_at > ? AND status!='draft' ORDER BY starts_at LIMIT 5", (now,))
    return {
        "upcoming": store.events_out(upcoming, admin=True),
        "unread": db.one("SELECT COUNT(*) n FROM messages WHERE read=0 AND archived=0")["n"],
        "pending_photos": db.one("SELECT COUNT(*) n FROM photos WHERE status='pending'")["n"],
        "subscribers": db.one("SELECT COUNT(*) n FROM subscribers WHERE active=1")["n"],
        "open_polls": db.one("SELECT COUNT(*) n FROM polls WHERE status='open'")["n"],
        "outbox_held": db.one("SELECT COUNT(*) n FROM outbox WHERE status IN ('held','failed')")["n"],
        "smtp_ready": mailer.smtp_config()["ready"],
        "recent": db.q("""SELECT * FROM (SELECT 'rsvp' kind, r.name, e.title what, r.created FROM rsvps r JOIN events e ON e.id=r.event_id
                          WHERE r.status='going'
                          UNION ALL SELECT 'signup', sg.name, sh.title, sg.created FROM signups sg
                          JOIN slots sl ON sl.id=sg.slot_id JOIN sheets sh ON sh.id=sl.sheet_id
                          UNION ALL SELECT 'poll', COALESCE(NULLIF(rs.name,''),'Someone'), p.title, rs.created FROM responses rs
                          JOIN polls p ON p.id=rs.poll_id)
                          ORDER BY created DESC LIMIT 12"""),
    }


# ---------- tags ----------

@router.get("/tags")
def tags(a=Admin):
    return store.all_tags()


@router.post("/tags")
def tag_create(body: dict = Body(...), a=Admin):
    name = clean(body.get("name"), 40)
    if not name:
        raise Invalid("Name the tag.", "name")
    tid = db.run("INSERT INTO tags(name, slug, color) VALUES (?,?,?)",
                 (name, db.slugify(name, "tags"), body.get("color") or "reef"))
    return db.one("SELECT * FROM tags WHERE id=?", (tid,))


@router.put("/tags/{tid}")
def tag_update(tid: int, body: dict = Body(...), a=Admin):
    name = clean(body.get("name"), 40)
    db.run("UPDATE tags SET name=?, slug=?, color=? WHERE id=?",
           (name, db.slugify(name, "tags", tid), body.get("color") or "reef", tid))
    return {"ok": True}


@router.delete("/tags/{tid}")
def tag_delete(tid: int, a=Admin):
    db.run("DELETE FROM tags WHERE id=?", (tid,))
    return {"ok": True}


# ---------- events ----------

def event_fields(body):
    title = clean(body.get("title"), 120)
    if not title:
        raise Invalid("Give the event a title.", "title")
    starts = clean(body.get("starts_at"), 16)
    try:
        datetime.fromisoformat(starts)
    except ValueError:
        raise Invalid("Pick a start date and time.", "starts_at")
    ends = clean(body.get("ends_at"), 16) or None
    if ends and ends < starts:
        raise Invalid("The end is before the start.", "ends_at")
    cap = body.get("capacity")
    reminders = sorted({int(h) for h in body.get("reminders") or [] if str(h).isdigit() and 0 < int(h) <= 336}, reverse=True)
    return {
        "title": title, "starts_at": starts, "ends_at": ends, "all_day": 1 if body.get("all_day") else 0,
        "location": clean(body.get("location"), 160), "map_url": store.safe_url(body.get("map_url"), "map_url"),
        "summary": clean(body.get("summary"), 240), "description": clean(body.get("description"), 8000, multiline=True),
        "cover_photo_id": body.get("cover_photo_id") or None,
        "status": body.get("status") if body.get("status") in ("draft", "published", "cancelled") else "published",
        "rsvp_enabled": 1 if body.get("rsvp_enabled", True) else 0,
        "capacity": int(cap) if str(cap or "").isdigit() and int(cap) > 0 else None,
        "reminders": json.dumps(reminders),
    }


@router.get("/events")
def events(a=Admin):
    return store.events_out(db.q("SELECT * FROM events ORDER BY starts_at DESC"), admin=True)


@router.get("/events/{eid}")
def event(eid: int, a=Admin):
    ev = db.one("SELECT * FROM events WHERE id=?", (eid,))
    if not ev:
        raise Invalid("Event not found.", status=404)
    out = store.event_detail(ev, admin=True)
    out["rsvps"] = db.q("SELECT id, name, email, guests, status, created FROM rsvps WHERE event_id=? ORDER BY status, created",
                        (eid,))
    return out


@router.post("/events")
def event_create(body: dict = Body(...), a=Admin):
    f = event_fields(body)
    f["slug"] = db.slugify(f["title"], "events")
    f["created"] = db.now_iso()
    cols = ",".join(f)
    eid = db.run(f"INSERT INTO events({cols}) VALUES ({','.join('?' * len(f))})", tuple(f.values()))
    store.set_tags("event_tags", "event_id", eid, body.get("tag_ids"))
    return {"id": eid}


@router.put("/events/{eid}")
def event_update(eid: int, body: dict = Body(...), a=Admin):
    old = db.one("SELECT * FROM events WHERE id=?", (eid,))
    if not old:
        raise Invalid("Event not found.", status=404)
    f = event_fields(body)
    # Links in sent emails must keep working, so the address only follows the title while it's a draft.
    f["slug"] = db.slugify(f["title"], "events", eid) if old["status"] == "draft" and f["title"] != old["title"] else old["slug"]
    db.run(f"UPDATE events SET {','.join(k + '=?' for k in f)} WHERE id=?", tuple(f.values()) + (eid,))
    store.set_tags("event_tags", "event_id", eid, body.get("tag_ids"))
    if body.get("notify_change") and (f["starts_at"] != old["starts_at"] or f["location"] != old["location"]
                                      or (f["status"] == "cancelled") != (old["status"] == "cancelled")):
        notify_attendees(eid, f["status"] == "cancelled")
    return {"id": eid, "slug": f["slug"]}


EVENT_PATCHABLE = ("title", "location", "description", "summary", "starts_at", "ends_at", "all_day", "cover_photo_id",
                   "map_url", "status", "capacity", "rsvp_enabled")


@router.patch("/events/{eid}")
def event_patch(eid: int, body: dict = Body(...), a=Admin):
    """Change a few fields in place (used by on-page editing). Everything else stays as it is."""
    old = db.one("SELECT * FROM events WHERE id=?", (eid,))
    if not old:
        raise Invalid("Event not found.", status=404)
    merged = dict(old)
    merged["reminders"] = json.loads(old["reminders"] or "[]")
    merged.update({k: body[k] for k in EVENT_PATCHABLE if k in body})
    f = event_fields(merged)
    f["slug"] = old["slug"]
    db.run(f"UPDATE events SET {','.join(k + '=?' for k in f)} WHERE id=?", tuple(f.values()) + (eid,))
    return store.events_out([db.one("SELECT * FROM events WHERE id=?", (eid,))])[0]


def attendee_emails(eid):
    people = {}
    for r in db.q("SELECT name, email, token FROM rsvps WHERE event_id=? AND status IN ('going','maybe')", (eid,)):
        people[r["email"].lower()] = r
    for r in db.q("""SELECT sg.name, sg.email, sg.token FROM signups sg JOIN slots sl ON sl.id=sg.slot_id
                     JOIN sheets sh ON sh.id=sl.sheet_id WHERE sh.event_id=?""", (eid,)):
        people.setdefault(r["email"].lower(), r)
    return people


def notify_attendees(eid, cancelled):
    ev = db.one("SELECT * FROM events WHERE id=?", (eid,))
    title = f"Cancelled: {ev['title']}" if cancelled else f"Updated: {ev['title']}"
    lead = "This event is cancelled." if cancelled else "The details for this event changed."
    for email, p in attendee_emails(eid).items():
        h, t = mailer.render(title, [lead, ("rows", [("When", mailer.fmt_when(ev)), ("Where", ev["location"])])],
                             button=("View event", f"{mailer.site_url()}/events/{ev['slug']}"),
                             footer_link=("Your sign-ups", f"{mailer.site_url()}/me/{p['token']}"))
        mailer.queue(email, title, h, t, mailer.ics_for([ev]), "update")


@router.post("/events/{eid}/duplicate")
def event_duplicate(eid: int, a=Admin):
    ev = db.one("SELECT * FROM events WHERE id=?", (eid,))
    ev.pop("id")
    ev["title"] = ev["title"] + " (copy)"
    ev["slug"] = db.slugify(ev["title"], "events")
    ev["status"] = "draft"
    ev["created"] = db.now_iso()
    new = db.run(f"INSERT INTO events({','.join(ev)}) VALUES ({','.join('?' * len(ev))})", tuple(ev.values()))
    for t in db.q("SELECT tag_id FROM event_tags WHERE event_id=?", (eid,)):
        db.run("INSERT INTO event_tags(event_id, tag_id) VALUES (?,?)", (new, t["tag_id"]))
    for s in db.q("SELECT * FROM sheets WHERE event_id=?", (eid,)):
        sid = db.run("INSERT INTO sheets(event_id, title, description, status, show_names, sort, created) VALUES (?,?,?,?,?,?,?)",
                     (new, s["title"], s["description"], s["status"], s["show_names"], s["sort"], db.now_iso()))
        for sl in db.q("SELECT * FROM slots WHERE sheet_id=?", (s["id"],)):
            db.run("INSERT INTO slots(sheet_id, title, note, capacity, ask_item, sort) VALUES (?,?,?,?,?,?)",
                   (sid, sl["title"], sl["note"], sl["capacity"], sl["ask_item"], sl["sort"]))
    return {"id": new}


@router.delete("/events/{eid}")
def event_delete(eid: int, a=Admin):
    db.run("DELETE FROM events WHERE id=?", (eid,))
    return {"ok": True}


@router.delete("/rsvps/{rid}")
def rsvp_delete(rid: int, a=Admin):
    db.run("DELETE FROM rsvps WHERE id=?", (rid,))
    return {"ok": True}


def csv_response(filename, header, rows):
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(header)
    w.writerows(rows)
    return StreamingResponse(iter([buf.getvalue()]), media_type="text/csv",
                             headers={"Content-Disposition": f'attachment; filename="{filename}"'})


@router.get("/events/{eid}/export.csv")
def event_export(eid: int, a=Admin):
    ev = db.one("SELECT slug FROM events WHERE id=?", (eid,))
    rows = [["RSVP", r["name"], r["email"], r["status"], r["guests"], "", "", r["created"]]
            for r in db.q("SELECT * FROM rsvps WHERE event_id=? ORDER BY created", (eid,))]
    rows += [["Sign-up", r["name"], r["email"], "", r["qty"], f"{r['sheet']}: {r['slot']}", r["item"], r["created"]]
             for r in db.q("""SELECT sg.*, sl.title slot, sh.title sheet FROM signups sg JOIN slots sl ON sl.id=sg.slot_id
                             JOIN sheets sh ON sh.id=sl.sheet_id WHERE sh.event_id=? ORDER BY sh.id, sl.sort""", (eid,))]
    return csv_response(f"{ev['slug']}-roster.csv", ["Type", "Name", "Email", "RSVP", "Guests/Qty", "Slot", "Bringing", "When"], rows)


# ---------- sign-up sheets ----------

@router.get("/sheets")
def sheets(a=Admin):
    return [store.sheet_out(s, admin=True) for s in db.q(
        "SELECT sh.* FROM sheets sh LEFT JOIN events e ON e.id=sh.event_id ORDER BY COALESCE(e.starts_at, sh.created) DESC")]


@router.get("/sheets/{sid}")
def sheet(sid: int, a=Admin):
    s = db.one("SELECT * FROM sheets WHERE id=?", (sid,))
    if not s:
        raise Invalid("Sign-up not found.", status=404)
    return store.sheet_out(s, admin=True)


def save_slots(sid, slots):
    keep = []
    for i, sl in enumerate(slots or []):
        title = clean(sl.get("title"), 120)
        if not title:
            continue
        cap = max(1, min(int(sl.get("capacity") or 1), 999))
        vals = (title, clean(sl.get("note"), 200), cap, clean(sl.get("starts_at"), 16) or None,
                clean(sl.get("ends_at"), 16) or None, 1 if sl.get("ask_item") else 0, i)
        if sl.get("id") and db.one("SELECT id FROM slots WHERE id=? AND sheet_id=?", (sl["id"], sid)):
            db.run("UPDATE slots SET title=?, note=?, capacity=?, starts_at=?, ends_at=?, ask_item=?, sort=? WHERE id=?",
                   vals + (sl["id"],))
            keep.append(int(sl["id"]))
        else:
            keep.append(db.run("INSERT INTO slots(title, note, capacity, starts_at, ends_at, ask_item, sort, sheet_id) "
                               "VALUES (?,?,?,?,?,?,?,?)", vals + (sid,)))
    marks = ",".join("?" * len(keep)) or "NULL"
    db.run(f"DELETE FROM slots WHERE sheet_id=? AND id NOT IN ({marks})", (sid, *keep))


def sheet_fields(body):
    title = clean(body.get("title"), 120)
    if not title:
        raise Invalid("Give the sign-up a title.", "title")
    return (body.get("event_id") or None, title, clean(body.get("description"), 1000, multiline=True),
            body.get("status") if body.get("status") in ("open", "closed", "hidden") else "open",
            clean(body.get("closes_at"), 16) or None, 1 if body.get("show_names", True) else 0)


@router.post("/sheets")
def sheet_create(body: dict = Body(...), a=Admin):
    sid = db.run("INSERT INTO sheets(event_id, title, description, status, closes_at, show_names, created) VALUES (?,?,?,?,?,?,?)",
                 sheet_fields(body) + (db.now_iso(),))
    save_slots(sid, body.get("slots"))
    return {"id": sid}


@router.put("/sheets/{sid}")
def sheet_update(sid: int, body: dict = Body(...), a=Admin):
    db.run("UPDATE sheets SET event_id=?, title=?, description=?, status=?, closes_at=?, show_names=? WHERE id=?",
           sheet_fields(body) + (sid,))
    save_slots(sid, body.get("slots"))
    return {"id": sid}


@router.delete("/sheets/{sid}")
def sheet_delete(sid: int, a=Admin):
    db.run("DELETE FROM sheets WHERE id=?", (sid,))
    return {"ok": True}


@router.patch("/sheets/{sid}")
def sheet_patch(sid: int, body: dict = Body(...), a=Admin):
    s = db.one("SELECT * FROM sheets WHERE id=?", (sid,))
    if not s:
        raise Invalid("Sign-up not found.", status=404)
    title = clean(body.get("title", s["title"]), 120)
    if not title:
        raise Invalid("Give the sign-up a title.", "title")
    db.run("UPDATE sheets SET title=?, description=? WHERE id=?",
           (title, clean(body.get("description", s["description"]), 1000, multiline=True), sid))
    return {"ok": True}


@router.post("/sheets/{sid}/slots")
def slot_add(sid: int, body: dict = Body(...), a=Admin):
    if not db.one("SELECT id FROM sheets WHERE id=?", (sid,)):
        raise Invalid("Sign-up not found.", status=404)
    title = clean(body.get("title"), 120)
    if not title:
        raise Invalid("Name the slot.", "title")
    cap = max(1, min(int(body.get("capacity") or 1), 999))
    n = db.one("SELECT COALESCE(MAX(sort),0)+1 n FROM slots WHERE sheet_id=?", (sid,))["n"]
    new = db.run("INSERT INTO slots(sheet_id, title, capacity, ask_item, sort) VALUES (?,?,?,?,?)",
                 (sid, title, cap, 1 if body.get("ask_item") else 0, n))
    return {"id": new}


@router.patch("/slots/{slot_id}")
def slot_patch(slot_id: int, body: dict = Body(...), a=Admin):
    sl = db.one("SELECT * FROM slots WHERE id=?", (slot_id,))
    if not sl:
        raise Invalid("Slot not found.", status=404)
    title = clean(body.get("title", sl["title"]), 120)
    if not title:
        raise Invalid("Name the slot.", "title")
    cap = sl["capacity"]
    if "capacity" in body:
        cap = int(body["capacity"]) if str(body["capacity"]).isdigit() else 0
        taken = db.one("SELECT COALESCE(SUM(qty),0) n FROM signups WHERE slot_id=?", (slot_id,))["n"]
        if cap < max(1, taken):
            raise Invalid(f"{taken} people already signed up, so it can't go below {max(1, taken)}.", "capacity")
        cap = min(cap, 999)
    db.run("UPDATE slots SET title=?, note=?, capacity=? WHERE id=?",
           (title, clean(body.get("note", sl["note"]), 200), cap, slot_id))
    return {"ok": True}


@router.delete("/slots/{slot_id}")
def slot_delete(slot_id: int, a=Admin):
    if db.one("SELECT 1 FROM signups WHERE slot_id=? LIMIT 1", (slot_id,)):
        raise Invalid("People are signed up for this slot. Remove them first.")
    db.run("DELETE FROM slots WHERE id=?", (slot_id,))
    return {"ok": True}


@router.delete("/signups/{uid}")
def signup_delete(uid: int, a=Admin):
    db.run("DELETE FROM signups WHERE id=?", (uid,))
    return {"ok": True}


@router.post("/slots/{slot_id}/signup")
def signup_add(slot_id: int, body: dict = Body(...), a=Admin):
    return store.signup(slot_id, body)


@router.get("/sheets/{sid}/export.csv")
def sheet_export(sid: int, a=Admin):
    s = store.sheet_out(db.one("SELECT * FROM sheets WHERE id=?", (sid,)), admin=True)
    rows = [[sl["title"], u["name"], u["email"], u["phone"], u["qty"], u["item"], u["created"]]
            for sl in s["slots"] for u in sl["signups"]]
    return csv_response(f"signup-{sid}.csv", ["Slot", "Name", "Email", "Phone", "Qty", "Bringing", "When"], rows)


# ---------- polls ----------

@router.get("/polls")
def polls(a=Admin):
    return [store.poll_out(p, with_questions=False) for p in db.q("SELECT * FROM polls ORDER BY created DESC")]


@router.get("/polls/{pid}")
def poll(pid: int, a=Admin):
    p = db.one("SELECT * FROM polls WHERE id=?", (pid,))
    if not p:
        raise Invalid("Poll not found.", status=404)
    out = store.poll_out(p)
    out["tally"] = store.poll_results(p)
    return out


def save_questions(pid, questions):
    keep = []
    for i, qq in enumerate(questions or []):
        prompt = clean(qq.get("prompt"), 300)
        kind = qq.get("kind") if qq.get("kind") in ("single", "multi", "text", "rating") else "single"
        if not prompt:
            continue
        opts = [clean(o, 120) for o in qq.get("options") or [] if clean(o, 120)]
        if kind in ("single", "multi") and len(opts) < 2:
            raise Invalid(f"Add at least two choices to “{prompt}”.")
        vals = (kind, prompt, json.dumps(opts), 1 if qq.get("required", True) else 0, i)
        if qq.get("id") and db.one("SELECT id FROM questions WHERE id=? AND poll_id=?", (qq["id"], pid)):
            db.run("UPDATE questions SET kind=?, prompt=?, options=?, required=?, sort=? WHERE id=?", vals + (qq["id"],))
            keep.append(int(qq["id"]))
        else:
            keep.append(db.run("INSERT INTO questions(kind, prompt, options, required, sort, poll_id) VALUES (?,?,?,?,?,?)",
                               vals + (pid,)))
    if not keep:
        raise Invalid("Add at least one question.")
    db.run(f"DELETE FROM questions WHERE poll_id=? AND id NOT IN ({','.join('?' * len(keep))})", (pid, *keep))


def poll_fields(body):
    title = clean(body.get("title"), 140)
    if not title:
        raise Invalid("Give the poll a title.", "title")
    return (title, clean(body.get("intro"), 600), body.get("event_id") or None,
            body.get("status") if body.get("status") in ("draft", "open", "closed") else "open",
            clean(body.get("closes_at"), 16) or None,
            body.get("results") if body.get("results") in ("public", "after", "admin") else "after",
            1 if body.get("collect_name", True) else 0, 1 if body.get("one_per_email", True) else 0)


@router.post("/polls")
def poll_create(body: dict = Body(...), a=Admin):
    f = poll_fields(body)
    with db.tx():
        pid = db.run("INSERT INTO polls(title, intro, event_id, status, closes_at, results, collect_name, one_per_email, slug, created) "
                     "VALUES (?,?,?,?,?,?,?,?,?,?)", f + (db.slugify(f[0], "polls"), db.now_iso()))
        try:
            save_questions(pid, body.get("questions"))
        except Invalid:
            db.run("DELETE FROM polls WHERE id=?", (pid,))
            raise
    return {"id": pid}


@router.put("/polls/{pid}")
def poll_update(pid: int, body: dict = Body(...), a=Admin):
    save_questions(pid, body.get("questions"))
    db.run("UPDATE polls SET title=?, intro=?, event_id=?, status=?, closes_at=?, results=?, collect_name=?, one_per_email=? "
           "WHERE id=?", poll_fields(body) + (pid,))
    return {"id": pid}


@router.patch("/polls/{pid}")
def poll_patch(pid: int, body: dict = Body(...), a=Admin):
    p = db.one("SELECT * FROM polls WHERE id=?", (pid,))
    if not p:
        raise Invalid("Poll not found.", status=404)
    title = clean(body.get("title", p["title"]), 140)
    if not title:
        raise Invalid("Give the poll a title.", "title")
    db.run("UPDATE polls SET title=?, intro=? WHERE id=?", (title, clean(body.get("intro", p["intro"]), 600), pid))
    return {"ok": True}


@router.delete("/polls/{pid}")
def poll_delete(pid: int, a=Admin):
    db.run("DELETE FROM polls WHERE id=?", (pid,))
    return {"ok": True}


@router.get("/polls/{pid}/export.csv")
def poll_export(pid: int, a=Admin):
    p = db.one("SELECT * FROM polls WHERE id=?", (pid,))
    qs = db.q("SELECT * FROM questions WHERE poll_id=? ORDER BY sort, id", (pid,))
    rows = []
    for r in db.q("SELECT * FROM responses WHERE poll_id=? ORDER BY created", (pid,)):
        ans = json.loads(r["answers"])
        vals = []
        for qq in qs:
            v = ans.get(str(qq["id"]), "")
            vals.append("; ".join(v) if isinstance(v, list) else v)
        rows.append([r["created"], r["name"], r["email"], *vals])
    return csv_response(f"{p['slug']}-responses.csv", ["When", "Name", "Email", *[qq["prompt"] for qq in qs]], rows)


# ---------- photos ----------

@router.get("/photos")
def photos(a=Admin):
    rows = db.q("SELECT * FROM photos WHERE status!='cover' ORDER BY status='approved', created DESC, id DESC")
    tags = store.tags_for("photo_tags", "photo_id", [r["id"] for r in rows])
    out = []
    for r in rows:
        p = store.photo_out(r)
        p.update(status=r["status"], event_id=r["event_id"], submitted_by=r["submitted_by"], created=r["created"],
                 tag_ids=[t["id"] for t in tags.get(r["id"], [])], tags=tags.get(r["id"], []))
        out.append(p)
    return out


@router.post("/photos")
async def photos_upload(event_id: str = Form(""), tag_ids: str = Form(""), files: list[UploadFile] = File(...), a=Admin):
    ev = int(event_id) if event_id.isdigit() else None
    tids = [int(t) for t in tag_ids.split(",") if t.strip().isdigit()]
    if ev:
        tids += [t["tag_id"] for t in db.q("SELECT tag_id FROM event_tags WHERE event_id=?", (ev,))]
    ids, errors = [], []
    for f in files:
        try:
            data = await f.read()
            if len(data) > 40 * 1024 * 1024:
                raise ValueError("over 40 MB")
            fn, th, w, h = media.save_image(data)
        except ValueError as e:
            errors.append(f"{f.filename}: {e}")
            continue
        pid = db.run("INSERT INTO photos(file, thumb, w, h, event_id, status, submitted_by, created) VALUES (?,?,?,?,?,?,?,?)",
                     (fn, th, w, h, ev, "approved", a["name"], db.now_iso()))
        for t in set(tids):
            db.run("INSERT OR IGNORE INTO photo_tags(photo_id, tag_id) VALUES (?,?)", (pid, t))
        ids.append(pid)
    return {"ids": ids, "errors": errors}


@router.put("/photos/{pid}")
def photo_update(pid: int, body: dict = Body(...), a=Admin):
    p = db.one("SELECT * FROM photos WHERE id=?", (pid,))
    if not p:
        raise Invalid("Photo not found.", status=404)
    db.run("UPDATE photos SET caption=?, event_id=?, status=? WHERE id=?",
           (clean(body.get("caption", p["caption"]), 300), body.get("event_id", p["event_id"]) or None,
            body.get("status") if body.get("status") in ("approved", "pending", "hidden") else p["status"], pid))
    if "tag_ids" in body:
        store.set_tags("photo_tags", "photo_id", pid, body["tag_ids"])
    return {"ok": True}


@router.post("/photos/bulk")
def photos_bulk(body: dict = Body(...), a=Admin):
    ids = [int(i) for i in body.get("ids") or []]
    action = body.get("action")
    for pid in ids:
        if action == "delete":
            p = db.one("SELECT * FROM photos WHERE id=?", (pid,))
            if p:
                db.run("DELETE FROM photos WHERE id=?", (pid,))
                media.delete_files(p)
        elif action in ("approved", "hidden"):
            db.run("UPDATE photos SET status=? WHERE id=?", (action, pid))
        elif action == "tag":
            for t in body.get("tag_ids") or []:
                db.run("INSERT OR IGNORE INTO photo_tags(photo_id, tag_id) VALUES (?,?)", (pid, int(t)))
        elif action == "event":
            db.run("UPDATE photos SET event_id=? WHERE id=?", (body.get("event_id") or None, pid))
    return {"ok": True}


# ---------- messages & people ----------

@router.get("/messages")
def messages(a=Admin):
    return db.q("SELECT * FROM messages ORDER BY archived, created DESC")


@router.put("/messages/{mid}")
def message_update(mid: int, body: dict = Body(...), a=Admin):
    m = db.one("SELECT * FROM messages WHERE id=?", (mid,))
    db.run("UPDATE messages SET read=?, archived=? WHERE id=?",
           (1 if body.get("read", m["read"]) else 0, 1 if body.get("archived", m["archived"]) else 0, mid))
    return {"ok": True}


@router.delete("/messages/{mid}")
def message_delete(mid: int, a=Admin):
    db.run("DELETE FROM messages WHERE id=?", (mid,))
    return {"ok": True}


@router.get("/people")
def people(a=Admin):
    subs = {r["email"]: dict(r, events=0, signups=0) for r in db.q("SELECT * FROM subscribers ORDER BY created DESC")}
    for r in db.q("SELECT lower(email) email, MAX(name) name, COUNT(*) n, MIN(created) created FROM rsvps GROUP BY lower(email)"):
        p = subs.setdefault(r["email"], {"email": r["email"], "name": r["name"], "active": None, "created": r["created"],
                                         "signups": 0, "source": "rsvp"})
        p["events"] = r["n"]
        p["name"] = p.get("name") or r["name"]
    for r in db.q("SELECT lower(email) email, MAX(name) name, COUNT(*) n, MIN(created) created FROM signups GROUP BY lower(email)"):
        p = subs.setdefault(r["email"], {"email": r["email"], "name": r["name"], "active": None, "created": r["created"],
                                         "events": 0, "source": "sign-up"})
        p["signups"] = r["n"]
        p["name"] = p.get("name") or r["name"]
    return sorted(subs.values(), key=lambda p: (p.get("name") or p["email"]).lower())


@router.post("/people")
def people_add(body: dict = Body(...), a=Admin):
    added = 0
    for line in (body.get("emails") or "").replace(",", "\n").splitlines():
        line = line.strip()
        if not line:
            continue
        name, email = "", line
        if "<" in line and ">" in line:
            name, email = line.split("<")[0].strip().strip('"'), line.split("<")[1].split(">")[0]
        try:
            store.subscribe(email, name, "admin")
            added += 1
        except Invalid:
            pass
    return {"added": added}


@router.put("/people")
def people_update(body: dict = Body(...), a=Admin):
    email = store.need_email(body.get("email"))
    if body.get("active"):
        store.subscribe(email, body.get("name", ""), "admin")
    else:
        db.run("UPDATE subscribers SET active=0 WHERE email=?", (email,))
    return {"ok": True}


@router.get("/people/export.csv")
def people_export(a=Admin):
    rows = [[p.get("name", ""), p["email"], "yes" if p.get("active") else "no", p.get("events", 0), p.get("signups", 0)]
            for p in people(a)]
    return csv_response("mahina-club-people.csv", ["Name", "Email", "On mailing list", "RSVPs", "Sign-ups"], rows)


# ---------- email ----------

def audience(spec):
    kind = spec.get("type")
    out = {}
    if kind in ("subscribers", "everyone"):
        for r in db.q("SELECT name, email, token FROM subscribers WHERE active=1"):
            out[r["email"]] = {"name": r["name"], "unsub": r["token"]}
    if kind == "everyone":
        for r in db.q("SELECT name, lower(email) email FROM rsvps UNION SELECT name, lower(email) FROM signups"):
            out.setdefault(r["email"], {"name": r["name"]})
    if kind == "event":
        for email, p in attendee_emails(int(spec.get("event_id") or 0)).items():
            out[email] = {"name": p["name"], "manage": p["token"]}
    if kind == "custom":
        for line in (spec.get("emails") or "").replace(",", "\n").splitlines():
            if store.EMAIL_RE.match(line.strip()):
                out[line.strip().lower()] = {"name": ""}
    for email in list(out):
        sub = db.one("SELECT active FROM subscribers WHERE email=?", (email,))
        if kind == "everyone" and sub and not sub["active"]:
            out.pop(email)
    return out


@router.post("/email/preview")
def email_preview(body: dict = Body(...), a=Admin):
    return {"count": len(audience(body.get("audience") or {}))}


@router.post("/email/send")
def email_send(body: dict = Body(...), a=Admin):
    subject = clean(body.get("subject"), 160)
    text = clean(body.get("body"), 10000, multiline=True)
    if not subject:
        raise Invalid("Add a subject.", "subject")
    if not text:
        raise Invalid("Write the message.", "body")
    people = audience(body.get("audience") or {})
    if not people:
        raise Invalid("No one is in that audience yet.")
    ev = db.one("SELECT * FROM events WHERE id=?", (body.get("event_id"),)) if body.get("event_id") else None
    paragraphs = [p.strip() for p in text.split("\n\n") if p.strip()]
    for email, p in people.items():
        blocks = list(paragraphs)
        button = None
        if ev:
            blocks.append(("rows", [("When", mailer.fmt_when(ev)), ("Where", ev["location"])]))
            button = ("RSVP" if ev["rsvp_enabled"] else "View event", f"{mailer.site_url()}/events/{ev['slug']}")
        foot = None
        if p.get("unsub"):
            foot = ("Unsubscribe", f"{mailer.site_url()}/unsubscribe/{p['unsub']}")
        elif p.get("manage"):
            foot = ("Your sign-ups", f"{mailer.site_url()}/me/{p['manage']}")
        h, t = mailer.render(subject, blocks, button=button, footer_link=foot)
        mailer.queue(email, subject, h, t, mailer.ics_for([ev]) if ev else None, "invite" if ev else "announcement")
    return {"queued": len(people), "smtp_ready": mailer.smtp_config()["ready"]}


@router.post("/email/test")
def email_test(a=Admin):
    h, t = mailer.render("Email is working", ["This test came from your Mahina Club site."])
    mailer.queue(a["email"], "Mahina Club test email", h, t, kind="test")
    cfg = mailer.smtp_config()
    if not cfg["ready"]:
        raise Invalid("Add an SMTP host and From address first.")
    try:
        row = db.one("SELECT * FROM outbox ORDER BY id DESC LIMIT 1")
        mailer.send_one(cfg, row)
        db.run("UPDATE outbox SET status='sent', sent_at=? WHERE id=?", (db.now_iso(), row["id"]))
    except Exception as e:
        db.run("UPDATE outbox SET status='failed', error=? WHERE id=(SELECT MAX(id) FROM outbox)", (str(e)[:300],))
        raise Invalid(f"Sending failed: {e}")
    return {"ok": True, "to": a["email"]}


@router.get("/outbox")
def outbox(a=Admin):
    return db.q("SELECT id, to_email, subject, kind, status, error, created, sent_at FROM outbox ORDER BY id DESC LIMIT 300")


@router.get("/outbox/{oid}")
def outbox_item(oid: int, a=Admin):
    return db.one("SELECT id, to_email, subject, html, status, error FROM outbox WHERE id=?", (oid,))


@router.post("/outbox/retry")
def outbox_retry(a=Admin):
    if not mailer.smtp_config()["ready"]:
        raise Invalid("Set up email in Settings first.")
    n = db.run("UPDATE outbox SET status='queued', error='' WHERE status IN ('held','failed')")
    mailer.flush()
    return {"ok": True}


@router.post("/outbox/clear")
def outbox_clear(a=Admin):
    db.run("DELETE FROM outbox WHERE status IN ('held','failed')")
    return {"ok": True}


# ---------- settings & admins ----------

PUBLIC_KEYS = ("moon_caption", "palette", "home_sections", "labels", "accent", "club_name", "org_line", "timezone", "email", "venmo", "donate_goal", "donate_uses", "banner", "spotlight",
               "officers", "public_uploads", "disclaimer", "site_url")


def sanitize_settings(b):
    """Validate admin-entered settings before they reach the public site or emails."""
    import re
    out = dict(b)
    for k in ("club_name", "org_line"):
        if k in out:
            out[k] = clean(out[k], 80) or ("Mahina Club" if k == "club_name" else "")
    if "email" in out and out["email"]:
        out["email"] = store.need_email(out["email"])
    if "site_url" in out:
        out["site_url"] = store.safe_url(out["site_url"], "site_url").rstrip("/")
    if "accent" in out and out["accent"] and not re.fullmatch(r"#[0-9a-fA-F]{6}", str(out["accent"])):
        out.pop("accent")
    if "palette" in out and out["palette"] not in db.PALETTES:
        out.pop("palette")
    if "venmo" in out:
        out["venmo"] = re.sub(r"[^A-Za-z0-9_-]", "", str(out["venmo"] or ""))[:30]
    if "disclaimer" in out:
        out["disclaimer"] = clean(out["disclaimer"], 600, multiline=True)
    if "timezone" in out:
        from zoneinfo import ZoneInfo
        try:
            ZoneInfo(str(out["timezone"]))
        except Exception:
            out.pop("timezone")
    if "banner" in out:
        bn = out["banner"] or {}
        out["banner"] = {"text": clean(bn.get("text"), 140), "link": store.safe_url(bn.get("link"), "banner_link", allow_path=True),
                         "active": bool(bn.get("active"))}
    if "donate_goal" in out:
        g = out["donate_goal"] or {}
        num = lambda v: max(0, min(float(v or 0), 10_000_000))
        out["donate_goal"] = {"label": clean(g.get("label"), 80), "goal": num(g.get("goal")), "raised": num(g.get("raised"))}
    if "donate_uses" in out:
        out["donate_uses"] = [clean(u, 120) for u in (out["donate_uses"] or [])[:12] if clean(u, 120)]
    if "officers" in out:
        offs = []
        for o in (out["officers"] or [])[:20]:
            em = clean(o.get("email"), 200)
            if em and not store.EMAIL_RE.match(em):
                raise Invalid(f"Check the email for {clean(o.get('name'), 60) or 'an officer'}.")
            offs.append({"role": clean(o.get("role"), 60), "name": clean(o.get("name"), 80), "email": em})
        out["officers"] = offs
    if "spotlight" in out:
        sp = out["spotlight"] or {}
        out["spotlight"] = {"kind": sp.get("kind") if sp.get("kind") in ("next", "event", "poll", "give", "none") else "next",
                            "id": int(sp["id"]) if str(sp.get("id") or "").isdigit() else None}
    if "home_sections" in out:
        known = [x["key"] for x in db.DEFAULT_SETTINGS["home_sections"]]
        seen, secs = set(), []
        for x in out["home_sections"] or []:
            k = (x or {}).get("key")
            if k in known and k not in seen:
                seen.add(k)
                secs.append({"key": k, "on": bool(x.get("on"))})
        secs += [{"key": k, "on": True} for k in known if k not in seen]
        out["home_sections"] = secs
    if "labels" in out:
        cur = {**db.DEFAULT_SETTINGS["labels"], **(db.get_setting("labels") or {})}
        for k, v in (out["labels"] or {}).items():
            if k in cur:
                cur[k] = clean(v, 60) or db.DEFAULT_SETTINGS["labels"][k]
        out["labels"] = cur
    if "moon_caption" in out:
        out["moon_caption"] = bool(out["moon_caption"])
    if "public_uploads" in out:
        out["public_uploads"] = bool(out["public_uploads"])
    if "smtp" in out:
        sm = out["smtp"] or {}
        out["smtp"] = {"host": clean(sm.get("host"), 200), "port": int(sm.get("port") or 587),
                       "security": sm.get("security") if sm.get("security") in ("starttls", "ssl", "none") else "starttls",
                       "user": clean(sm.get("user"), 200), "password": str(sm.get("password") or "")[:500],
                       "from": store.need_email(sm["from"]) if sm.get("from") else ""}
    return out


@router.get("/settings")
def settings(a=Admin):
    s = db.all_settings()
    smtp = dict(s.get("smtp") or {})
    smtp["password"] = "••••••••" if smtp.get("password") else ""
    cfg = mailer.smtp_config()
    return {**{k: s.get(k) for k in PUBLIC_KEYS}, "smtp": smtp, "smtp_from_env": cfg["from_env"], "smtp_ready": cfg["ready"]}


@router.put("/settings")
def settings_update(body: dict = Body(...), a=Admin):
    body = sanitize_settings(body)
    for k in PUBLIC_KEYS:
        if k in body:
            db.set_setting(k, body[k])
    if "smtp" in body:
        cur = db.get_setting("smtp") or {}
        new = {k: body["smtp"].get(k, cur.get(k)) for k in ("host", "port", "user", "password", "from", "security")}
        if new["password"] == "••••••••":
            new["password"] = cur.get("password", "")
        db.set_setting("smtp", new)
    return settings(a)


@router.post("/settings/cover")
async def upload_single(file: UploadFile = File(...), a=Admin):
    """Upload one image for an event cover without putting it in the gallery."""
    try:
        fn, th, w, h = media.save_image(await file.read())
    except ValueError as e:
        raise Invalid(str(e))
    pid = db.run("INSERT INTO photos(file, thumb, w, h, status, submitted_by, created) VALUES (?,?,?,?,?,?,?)",
                 (fn, th, w, h, "cover", a["name"], db.now_iso()))
    return store.photo_out(db.one("SELECT * FROM photos WHERE id=?", (pid,)))


@router.get("/admins")
def admins(a=Admin):
    return db.q("SELECT id, email, name, created FROM admins ORDER BY created")


@router.post("/admins")
def admin_create(body: dict = Body(...), a=Admin):
    name, email = store.need_name(body.get("name")), store.need_email(body.get("email"))
    if db.one("SELECT id FROM admins WHERE email=?", (email,)):
        raise Invalid("That person is already an admin.", "email")
    pw_hash = ""
    if auth.password_login_enabled():
        pw = auth.check_new_password(body.get("password") or "", email=email, name=name)
        pw_hash = auth.hash_password(pw)
    db.run("INSERT INTO admins(email, name, pw_hash, created) VALUES (?,?,?,?)", (email, name, pw_hash, db.now_iso()))
    return {"ok": True}


@router.delete("/admins/{aid}")
def admin_delete(aid: int, a=Admin):
    if aid == a["id"]:
        raise Invalid("You can't remove yourself.")
    db.run("DELETE FROM sessions WHERE admin_id=?", (aid,))
    db.run("DELETE FROM admins WHERE id=?", (aid,))
    return {"ok": True}


@router.post("/password")
def change_password(request: Request, body: dict = Body(...), a=Admin):
    row = db.one("SELECT * FROM admins WHERE id=?", (a["id"],))
    if row["pw_hash"]:
        ok, _ = auth.verify_password(body.get("current") or "", row["pw_hash"])
        if not ok:
            raise Invalid("Your current password is wrong.", "current")
    pw = auth.check_new_password(body.get("new") or "", email=row["email"], name=row["name"], field="new")
    db.run("UPDATE admins SET pw_hash=? WHERE id=?", (auth.hash_password(pw), a["id"]))
    auth.end_other_sessions(a["id"], request.cookies.get(COOKIE))
    return {"ok": True}
