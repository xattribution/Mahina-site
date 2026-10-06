"""Shared queries, serializers and business rules used by the public and admin APIs."""
import json
import re
from datetime import datetime

from . import db, mailer

# Deliberately strict: no quotes, spaces, or URL characters, so an address is always safe in a header or mailto link.
EMAIL_RE = re.compile(r"^[A-Za-z0-9._%+'-]{1,64}@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,24}$")
_CTRL = re.compile(r"[\x00-\x08\x0b-\x1f\x7f-\x9f\u200b-\u200f\u202a-\u202e\u2066-\u2069]")
_CTRL_LINE = re.compile(r"[\x00-\x1f\x7f-\x9f\u200b-\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069]")


class Invalid(Exception):
    def __init__(self, message, field=None, status=400):
        super().__init__(message)
        self.message, self.field, self.status = message, field, status


def clean(s, n=200, multiline=False):
    """Trim, cap length, and drop control and bidi-override characters.
    Single-line fields lose line breaks too, so they can't break out of an email header or ICS line."""
    s = s if isinstance(s, str) else ("" if s is None else str(s))
    s = s.replace("\r\n", "\n")
    s = (_CTRL if multiline else _CTRL_LINE).sub(" " if not multiline else "", s)
    return s.strip()[:n]


def safe_url(u, field, allow_path=False):
    """Admin-entered links: only web addresses (or site paths), never javascript: and friends."""
    u = clean(u, 400)
    if not u:
        return ""
    if allow_path and u.startswith("/") and not u.startswith("//"):
        return u
    if re.match(r"^https?://[^\s/$.?#][^\s]*$", u, re.I):
        return u
    raise Invalid("Use a full web address starting with https://" + (" or a page path like /events" if allow_path else "") + ".", field)


def need_email(email):
    email = clean(email, 200).lower()
    if not EMAIL_RE.match(email):
        raise Invalid("Enter an email address like name@example.com.", "email")
    return email


def need_name(name):
    name = clean(name, 80)
    if not name:
        raise Invalid("Enter your name.", "name")
    return name


def short_name(name):
    parts = (name or "").split()
    if len(parts) >= 2:
        return f"{parts[0]} {parts[-1][0]}."
    return parts[0] if parts else ""


def photo_out(p):
    if not p:
        return None
    return {"id": p["id"], "src": f"/media/{p['file']}", "thumb": f"/media/{p['thumb']}",
            "w": p["w"], "h": p["h"], "caption": p.get("caption") or ""}


# ---------- tags ----------

def tags_for(table, key, ids):
    if not ids:
        return {}
    marks = ",".join("?" * len(ids))
    rows = db.q(f"SELECT x.{key} oid, t.id, t.name, t.slug, t.color FROM {table} x JOIN tags t ON t.id=x.tag_id "
                f"WHERE x.{key} IN ({marks}) ORDER BY t.name", tuple(ids))
    out = {}
    for r in rows:
        out.setdefault(r["oid"], []).append({"id": r["id"], "name": r["name"], "slug": r["slug"], "color": r["color"]})
    return out


def set_tags(table, key, oid, tag_ids):
    db.run(f"DELETE FROM {table} WHERE {key}=?", (oid,))
    for t in tag_ids or []:
        db.run(f"INSERT OR IGNORE INTO {table}({key}, tag_id) VALUES (?, ?)", (oid, int(t)))


def all_tags():
    return db.q("""SELECT t.*, (SELECT COUNT(*) FROM event_tags e WHERE e.tag_id=t.id) events,
                   (SELECT COUNT(*) FROM photo_tags p JOIN photos ph ON ph.id=p.photo_id
                    WHERE p.tag_id=t.id AND ph.status='approved') photos
                   FROM tags t ORDER BY t.name""")


# ---------- events ----------

def going_count(event_id):
    r = db.one("SELECT COUNT(*) n, COALESCE(SUM(guests),0) g FROM rsvps WHERE event_id=? AND status='going'", (event_id,))
    return r["n"] + r["g"]


def events_out(rows, admin=False):
    ids = [r["id"] for r in rows]
    tags = tags_for("event_tags", "event_id", ids)
    covers = {}
    cover_ids = [r["cover_photo_id"] for r in rows if r.get("cover_photo_id")]
    if cover_ids:
        for p in db.q(f"SELECT * FROM photos WHERE id IN ({','.join('?' * len(cover_ids))})", tuple(cover_ids)):
            covers[p["id"]] = photo_out(p)
    photo_counts = {r["event_id"]: r["n"] for r in db.q(
        "SELECT event_id, COUNT(*) n FROM photos WHERE status='approved' AND event_id IS NOT NULL GROUP BY event_id")}
    sheet_counts = {r["event_id"]: r for r in db.q(
        """SELECT sh.event_id, COUNT(DISTINCT sl.id) slots, COALESCE(SUM(sl.capacity),0) cap,
           (SELECT COALESCE(SUM(sg.qty),0) FROM signups sg JOIN slots s2 ON s2.id=sg.slot_id JOIN sheets h2 ON h2.id=s2.sheet_id
            WHERE h2.event_id=sh.event_id) filled
           FROM sheets sh JOIN slots sl ON sl.sheet_id=sh.id WHERE sh.event_id IS NOT NULL AND sh.status='open'
           GROUP BY sh.event_id""")}
    out = []
    for r in rows:
        e = {k: r[k] for k in ("id", "slug", "title", "starts_at", "ends_at", "location", "map_url", "summary",
                               "status", "capacity")}
        e["all_day"] = bool(r["all_day"])
        e["rsvp_enabled"] = bool(r["rsvp_enabled"])
        e["tags"] = tags.get(r["id"], [])
        e["cover"] = covers.get(r.get("cover_photo_id"))
        e["going"] = going_count(r["id"])
        e["photos"] = photo_counts.get(r["id"], 0)
        sc = sheet_counts.get(r["id"])
        e["signup"] = {"slots": sc["slots"], "open": max(0, sc["cap"] - sc["filled"])} if sc else None
        if admin:
            e["description"] = r["description"]
            e["cover_photo_id"] = r["cover_photo_id"]
            e["reminders"] = json.loads(r.get("reminders") or "[]")
            e["tag_ids"] = [t["id"] for t in e["tags"]]
        out.append(e)
    return out


def event_detail(ev, admin=False):
    e = events_out([ev], admin)[0]
    e["description"] = ev["description"]
    e["sheets"] = [sheet_out(s, admin) for s in db.q("SELECT * FROM sheets WHERE event_id=? ORDER BY sort, id", (ev["id"],))
                   if admin or s["status"] != "hidden"]
    e["polls"] = [{"slug": p["slug"], "title": p["title"], "status": p["status"]} for p in
                  db.q("SELECT slug, title, status FROM polls WHERE event_id=? AND status!='draft'", (ev["id"],))]
    if e["capacity"]:
        e["spots_left"] = max(0, e["capacity"] - e["going"])
    return e


# ---------- sheets ----------

def sheet_out(s, admin=False):
    slots = db.q("SELECT * FROM slots WHERE sheet_id=? ORDER BY sort, starts_at, id", (s["id"],))
    out_slots = []
    for sl in slots:
        ups = db.q("SELECT * FROM signups WHERE slot_id=? ORDER BY id", (sl["id"],))
        taken = sum(u["qty"] for u in ups)
        item = {"id": sl["id"], "title": sl["title"], "note": sl["note"], "capacity": sl["capacity"],
                "starts_at": sl["starts_at"], "ends_at": sl["ends_at"], "ask_item": bool(sl["ask_item"]),
                "taken": taken, "left": max(0, sl["capacity"] - taken)}
        if admin:
            item["signups"] = [{k: u[k] for k in ("id", "name", "email", "phone", "qty", "item", "created")} for u in ups]
        elif s["show_names"]:
            item["people"] = [{"name": short_name(u["name"]), "item": u["item"], "qty": u["qty"]} for u in ups]
        out_slots.append(item)
    closed = s["status"] != "open" or (s["closes_at"] and s["closes_at"] < db.now_iso())
    o = {"id": s["id"], "event_id": s["event_id"], "title": s["title"], "description": s["description"],
         "status": s["status"], "closes_at": s["closes_at"], "closed": bool(closed), "show_names": bool(s["show_names"]),
         "slots": out_slots, "filled": sum(x["taken"] for x in out_slots),
         "capacity": sum(x["capacity"] for x in out_slots)}
    if s["event_id"]:
        ev = db.one("SELECT slug, title, starts_at, location FROM events WHERE id=?", (s["event_id"],))
        o["event"] = ev
    return o


def my_token(email):
    """Reuse one manage-link token per email so a person's link shows everything they signed up for."""
    for t in ("rsvps", "signups"):
        r = db.one(f"SELECT token FROM {t} WHERE lower(email)=? ORDER BY id DESC LIMIT 1", (email.lower(),))
        if r:
            return r["token"]
    return db.token()


def confirm_email(email, name, token, title, rows, ev=None):
    h, t = mailer.render(title, [f"Mahalo, {name.split()[0]}.", ("rows", rows)],
                         button=("View event", f"{mailer.site_url()}/events/{ev['slug']}") if ev else None,
                         footer_link=("Change or cancel", f"{mailer.site_url()}/me/{token}"))
    mailer.queue(email, title, h, t, mailer.ics_for([ev]) if ev else None, "confirmation")


def signup(slot_id, body):
    slot = db.one("SELECT * FROM slots WHERE id=?", (slot_id,))
    if not slot:
        raise Invalid("That slot no longer exists.", status=404)
    sheet = db.one("SELECT * FROM sheets WHERE id=?", (slot["sheet_id"],))
    if sheet["status"] != "open" or (sheet["closes_at"] and sheet["closes_at"] < db.now_iso()):
        raise Invalid("This sign-up is closed.")
    name, email = need_name(body.get("name")), need_email(body.get("email"))
    qty = max(1, min(int(body.get("qty") or 1), 50))
    item = clean(body.get("item"), 120)
    if slot["ask_item"] and not item:
        raise Invalid("Tell everyone what you're bringing.", "item")
    taken = db.one("SELECT COALESCE(SUM(qty),0) n FROM signups WHERE slot_id=?", (slot_id,))["n"]
    if taken + qty > slot["capacity"]:
        left = slot["capacity"] - taken
        raise Invalid("This slot just filled up." if left <= 0 else f"Only {left} left in this slot.", "qty")
    tok = my_token(email)
    sid = db.run("INSERT INTO signups(slot_id, name, email, phone, qty, item, token, created) VALUES (?,?,?,?,?,?,?,?)",
                 (slot_id, name, email, clean(body.get("phone"), 30), qty, item, tok, db.now_iso()))
    ev = db.one("SELECT * FROM events WHERE id=?", (sheet["event_id"],)) if sheet["event_id"] else None
    rows = [("Sign-up", sheet["title"]), ("Slot", slot["title"] + (f" ×{qty}" if qty > 1 else "")), ("Bringing", item)]
    if slot["starts_at"]:
        rows.append(("Time", fmt_slot_time(slot)))
    if ev:
        rows += [("Event", ev["title"]), ("When", mailer.fmt_when(ev)), ("Where", ev["location"])]
    confirm_email(email, name, tok, f"You're signed up: {slot['title']}", rows, ev)
    return {"id": sid}


def fmt_slot_time(slot):
    d = datetime.fromisoformat(slot["starts_at"])
    s = d.strftime("%a %b ") + str(d.day) + ", " + d.strftime("%I:%M %p").lstrip("0")
    if slot.get("ends_at"):
        s += "–" + datetime.fromisoformat(slot["ends_at"]).strftime("%I:%M %p").lstrip("0")
    return s


def rsvp(ev, body):
    if not ev["rsvp_enabled"]:
        raise Invalid("RSVPs are off for this event.")
    if ev["starts_at"] < db.now_iso():
        raise Invalid("This event has already started.")
    name, email = need_name(body.get("name")), need_email(body.get("email"))
    guests = max(0, min(int(body.get("guests") or 0), 20))
    status = body.get("status") if body.get("status") in ("going", "maybe", "no") else "going"
    existing = db.one("SELECT * FROM rsvps WHERE event_id=? AND lower(email)=?", (ev["id"], email))
    if status == "going" and ev["capacity"]:
        current = going_count(ev["id"]) - ((1 + existing["guests"]) if existing and existing["status"] == "going" else 0)
        if current + 1 + guests > ev["capacity"]:
            left = ev["capacity"] - current
            raise Invalid("This event is full." if left <= 0 else f"Only {left} spots left.", "guests")
    if existing and existing["status"] == "going":
        # Don't let anyone change someone else's RSVP by typing their email. Re-send their link instead.
        rows = [("When", mailer.fmt_when(ev)), ("Where", ev["location"])]
        confirm_email(email, existing["name"], existing["token"], f"You're going to {ev['title']}", rows, ev)
        return {"status": "going", "already": True, "going": going_count(ev["id"])}
    tok = existing["token"] if existing else my_token(email)
    if existing:
        db.run("UPDATE rsvps SET status=?, guests=? WHERE id=?", (status, guests, existing["id"]))
    else:
        db.run("INSERT INTO rsvps(event_id, name, email, guests, status, token, created) VALUES (?,?,?,?,?,?,?)",
               (ev["id"], name, email, guests, status, tok, db.now_iso()))
    if status == "going":
        rows = [("When", mailer.fmt_when(ev)), ("Where", ev["location"]),
                ("Guests", f"You + {guests}" if guests else "")]
        confirm_email(email, name, tok, f"You're going to {ev['title']}", rows, ev)
    return {"status": status, "going": going_count(ev["id"])}


def subscribe(email, name="", source=""):
    email = need_email(email)
    r = db.one("SELECT * FROM subscribers WHERE email=?", (email,))
    if r:
        if not r["active"]:
            db.run("UPDATE subscribers SET active=1 WHERE id=?", (r["id"],))
        return r["token"]
    tok = db.token()
    db.run("INSERT INTO subscribers(name, email, token, source, created) VALUES (?,?,?,?,?)",
           (clean(name, 80), email, tok, source, db.now_iso()))
    return tok


def forget(email):
    """Delete everything stored about one email address. Poll answers stay in the totals with the name removed."""
    email = email.lower()
    out = {}
    with db.tx() as c:
        run = lambda sql: c.execute(sql, (email,)).rowcount
        out["mailing_list"] = run("DELETE FROM subscribers WHERE lower(email)=?")
        out["rsvps"] = run("DELETE FROM rsvps WHERE lower(email)=?")
        out["signups"] = run("DELETE FROM signups WHERE lower(email)=?")
        out["messages"] = run("DELETE FROM messages WHERE lower(email)=?")
        out["poll_answers"] = run("UPDATE responses SET name='', email='' WHERE lower(email)=?")
        out["photos"] = run("UPDATE photos SET submitted_by='' WHERE instr(lower(submitted_by), ?) > 0")
        out["emails"] = run("DELETE FROM outbox WHERE lower(to_email)=?")
        run("DELETE FROM reminders_sent WHERE lower(email)=?")
    return out


# ---------- polls ----------

def poll_out(p, with_questions=True):
    o = {k: p[k] for k in ("id", "slug", "title", "intro", "status", "closes_at", "results")}
    o["collect_name"] = bool(p["collect_name"])
    o["one_per_email"] = bool(p["one_per_email"])
    o["event_id"] = p["event_id"]
    o["closed"] = p["status"] == "closed" or bool(p["closes_at"] and p["closes_at"] < db.now_iso())
    o["responses"] = db.one("SELECT COUNT(*) n FROM responses WHERE poll_id=?", (p["id"],))["n"]
    if p["event_id"]:
        o["event"] = db.one("SELECT slug, title, starts_at FROM events WHERE id=?", (p["event_id"],))
    if with_questions:
        o["questions"] = [{"id": x["id"], "kind": x["kind"], "prompt": x["prompt"], "options": json.loads(x["options"]),
                           "required": bool(x["required"])}
                          for x in db.q("SELECT * FROM questions WHERE poll_id=? ORDER BY sort, id", (p["id"],))]
    return o


def poll_results(p):
    qs = db.q("SELECT * FROM questions WHERE poll_id=? ORDER BY sort, id", (p["id"],))
    resp = [json.loads(r["answers"]) for r in db.q("SELECT answers FROM responses WHERE poll_id=?", (p["id"],))]
    out = []
    for qq in qs:
        key = str(qq["id"])
        vals = [r.get(key) for r in resp if r.get(key) not in (None, "", [])]
        item = {"id": qq["id"], "kind": qq["kind"], "prompt": qq["prompt"], "answered": len(vals)}
        if qq["kind"] in ("single", "multi"):
            opts = json.loads(qq["options"])
            counts = {o: 0 for o in opts}
            for v in vals:
                for x in (v if isinstance(v, list) else [v]):
                    counts[x] = counts.get(x, 0) + 1
            item["counts"] = [{"option": k, "n": n} for k, n in counts.items()]
        elif qq["kind"] == "rating":
            nums = [int(v) for v in vals if str(v).isdigit()]
            item["average"] = round(sum(nums) / len(nums), 2) if nums else None
            item["counts"] = [{"option": str(i), "n": nums.count(i)} for i in range(1, 6)]
        else:
            item["text"] = vals[-50:]
        out.append(item)
    return out


def respond(p, body):
    po = poll_out(p)
    if po["closed"] or p["status"] != "open":
        raise Invalid("This poll is closed.")
    answers, clean_answers = body.get("answers") or {}, {}
    for qq in po["questions"]:
        v = answers.get(str(qq["id"]))
        if qq["kind"] == "single":
            v = v if v in qq["options"] else None
        elif qq["kind"] == "multi":
            v = [x for x in (v or []) if x in qq["options"]] or None
        elif qq["kind"] == "rating":
            v = str(v) if str(v) in ("1", "2", "3", "4", "5") else None
        else:
            v = clean(v, 2000, multiline=True) or None
        if qq["required"] and v is None:
            raise Invalid("Answer every required question.", f"q{qq['id']}")
        if v is not None:
            clean_answers[str(qq["id"])] = v
    name, email = "", ""
    if p["collect_name"]:
        name = need_name(body.get("name"))
        email = need_email(body.get("email")) if p["one_per_email"] else clean(body.get("email"), 200).lower()
        if p["one_per_email"]:
            if db.one("SELECT id FROM responses WHERE poll_id=? AND email=?", (p["id"], email)):
                raise Invalid("This email already answered this poll.", "email")
    db.run("INSERT INTO responses(poll_id, name, email, answers, created) VALUES (?,?,?,?,?)",
           (p["id"], name, email, json.dumps(clean_answers), db.now_iso()))
    return {"updated": False}
