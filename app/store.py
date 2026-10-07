"""Shared queries, serializers and business rules used by the public and admin APIs."""
import json
import re
from datetime import datetime, timedelta

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
    if allow_path and re.match(r"^[a-z0-9-]+(/[\w\-./?=&#%]*)?$", u, re.I) and "." not in u.split("/")[0]:
        return "/" + u  # "events/potluck" means the site page /events/potluck
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
            WHERE h2.event_id=sh.event_id AND h2.status='open' AND s2.capacity > 0) filled
           FROM sheets sh JOIN slots sl ON sl.sheet_id=sh.id WHERE sh.event_id IS NOT NULL AND sh.status='open' AND sl.capacity > 0
           GROUP BY sh.event_id""")}
    venmo = db.get_setting("venmo")
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
        e["donate"] = bool(r.get("donate")) and bool(venmo)
        e["donate_note"] = r.get("donate_note") or "" if e["donate"] else ""
        if admin:
            e["description"] = r["description"]
            e["cover_photo_id"] = r["cover_photo_id"]
            e["reminders"] = json.loads(r.get("reminders") or "[]")
            e["tag_ids"] = [t["id"] for t in e["tags"]]
            e["donate_on"] = bool(r.get("donate"))
            e["donate_note"] = r.get("donate_note") or ""
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

OTHER_TITLE = "Something else"


def slot_choices(sl):
    try:
        raw = json.loads(sl.get("choices") or "[]")
    except ValueError:
        return []
    return [{"id": str(c.get("id")), "title": c.get("title", ""), "need": int(c.get("need") or 1)} for c in raw if isinstance(c, dict) and c.get("id")]


def clean_choices(raw, old=None):
    """Validate an admin's list of specific items for a slot. Keeps ids of items that already exist so claims stay attached."""
    import secrets
    known = {c["id"] for c in (old or [])}
    out, seen = [], set()
    for c in (raw or [])[:40]:
        title = clean((c or {}).get("title"), 80)
        if not title:
            continue
        cid = str(c.get("id") or "")
        if cid not in known or cid in seen:
            cid = secrets.token_hex(4)
        seen.add(cid)
        need = str(c.get("need") or 1)
        out.append({"id": cid, "title": title, "need": max(1, min(int(need) if need.isdigit() else 1, 99))})
    return out


def sheet_out(s, admin=False):
    """A sign-up sheet. What people are bringing is always public, so everyone can see the spread.
    Names show as first name and last initial, and only when the sheet allows it. Emails never leave the admin side.
    A slot with capacity 0 has no limit on how many people sign up."""
    slots = db.q("SELECT * FROM slots WHERE sheet_id=? ORDER BY is_other, sort, starts_at, id", (s["id"],))
    photo_ids = [sl["photo_id"] for sl in slots if sl.get("photo_id")]
    photos = {p["id"]: photo_out(p) for p in db.q(
        f"SELECT * FROM photos WHERE id IN ({','.join('?' * len(photo_ids))})", tuple(photo_ids))} if photo_ids else {}
    out_slots = []
    for sl in slots:
        if sl["is_other"] and not s["allow_other"] and not db.one("SELECT 1 FROM signups WHERE slot_id=?", (sl["id"],)):
            continue
        ups = db.q("SELECT * FROM signups WHERE slot_id=? ORDER BY id", (sl["id"],))
        taken = sum(u["qty"] for u in ups)
        cap = sl["capacity"] or 0
        # Optional specific items inside a slot (Turkey, Ham...). People claim one, and it shows as taken.
        choices = []
        for ch in slot_choices(sl):
            mine = [u for u in ups if u["choice_id"] == ch["id"]]
            got = sum(u["qty"] for u in mine)
            c = {"id": ch["id"], "title": ch["title"], "need": ch["need"], "taken": got, "left": max(0, ch["need"] - got)}
            c["by"] = [short_name(u["name"]) for u in mine] if (s["show_names"] or admin) else []
            choices.append(c)
        item = {"id": sl["id"], "title": sl["title"], "note": sl["note"], "capacity": cap, "unlimited": cap == 0,
                "starts_at": sl["starts_at"], "ends_at": sl["ends_at"], "ask_item": bool(sl["ask_item"]),
                "ask_servings": bool(sl["ask_servings"]), "is_other": bool(sl["is_other"]),
                "photo_id": sl["photo_id"], "image": photos.get(sl["photo_id"]),
                "taken": taken, "left": 999 if cap == 0 else max(0, cap - taken),
                "servings": sum(u["servings"] or 0 for u in ups), "choices": choices}
        if admin:
            item["signups"] = [{k: u[k] for k in ("id", "name", "email", "phone", "qty", "item", "servings", "choice_id", "created")} for u in ups]
        else:
            item["people"] = [{"name": short_name(u["name"]) if s["show_names"] else "", "item": u["item"], "qty": u["qty"],
                               "servings": u["servings"], "choice": u["choice_id"]} for u in ups]
        out_slots.append(item)
    closed = s["status"] != "open" or (s["closes_at"] and s["closes_at"] < db.now_iso())
    limited = [x for x in out_slots if not x["unlimited"]]
    o = {"id": s["id"], "event_id": s["event_id"], "title": s["title"], "description": s["description"],
         "status": s["status"], "closes_at": s["closes_at"], "closed": bool(closed), "show_names": bool(s["show_names"]),
         "allow_other": bool(s["allow_other"]), "slots": out_slots,
         "filled": sum(x["taken"] for x in limited), "capacity": sum(x["capacity"] for x in limited),
         "people": sum(x["taken"] for x in out_slots), "servings": sum(x["servings"] for x in out_slots)}
    if s["event_id"]:
        ev = db.one("SELECT slug, title, starts_at, location FROM events WHERE id=?", (s["event_id"],))
        if ev:
            ev["going"] = going_count(s["event_id"])
        o["event"] = ev
    return o


def ensure_other_slot(sheet_id, on):
    """The "Something else" slot lets people bring what isn't on the list. Turning it off keeps it while people are in it."""
    other = db.one("SELECT id FROM slots WHERE sheet_id=? AND is_other=1", (sheet_id,))
    if on and not other:
        asks = db.one("SELECT MAX(ask_servings) a FROM slots WHERE sheet_id=? AND is_other=0", (sheet_id,))["a"] or 0
        db.run("INSERT INTO slots(sheet_id, title, capacity, ask_item, ask_servings, is_other, sort) VALUES (?,?,0,1,?,1,9999)",
               (sheet_id, OTHER_TITLE, asks))
    elif on and other:
        asks = db.one("SELECT MAX(ask_servings) a FROM slots WHERE sheet_id=? AND is_other=0", (sheet_id,))["a"] or 0
        db.run("UPDATE slots SET ask_servings=? WHERE id=?", (asks, other["id"]))
    elif not on and other and not db.one("SELECT 1 FROM signups WHERE slot_id=?", (other["id"],)):
        db.run("DELETE FROM slots WHERE id=?", (other["id"],))


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
    if slot["is_other"] and not sheet["allow_other"]:
        raise Invalid("This sign-up isn't taking other items.")
    qty = max(1, min(int(body.get("qty") or 1), 50)) if slot["capacity"] else 1
    item = clean(body.get("item"), 120)
    choices = {c["id"]: c for c in slot_choices(slot)}
    choice = choices.get(str(body.get("choice") or "")) if choices else None
    if body.get("choice") and choices and not choice:
        raise Invalid("That item isn't on the list anymore. Refresh the page.", "choice")
    if choice:
        item, qty = choice["title"], 1
    elif choices and not slot["ask_item"]:
        raise Invalid("Pick what you're bringing.", "choice")
    if (slot["ask_item"] or slot["is_other"]) and not item:
        raise Invalid("Tell everyone what you're bringing.", "item")
    servings = None
    if slot["ask_servings"]:
        raw = str(body.get("servings") or "").strip()
        if not raw.isdigit() or not 1 <= int(raw) <= 500:
            raise Invalid("About how many people will it feed? Enter a number.", "servings")
        servings = int(raw)
    tok = my_token(email)
    # Check room and insert under one write lock, so two people can't both take the last spot or the same item.
    c = db.conn()
    if c.in_transaction:
        c.commit()
    c.execute("BEGIN IMMEDIATE")
    try:
        if slot["capacity"]:
            taken = c.execute("SELECT COALESCE(SUM(qty),0) FROM signups WHERE slot_id=?", (slot_id,)).fetchone()[0]
            if taken + qty > slot["capacity"]:
                left = slot["capacity"] - taken
                raise Invalid("This slot just filled up." if left <= 0 else f"Only {left} left in this slot.", "qty")
        if choice:
            got = c.execute("SELECT COALESCE(SUM(qty),0) FROM signups WHERE slot_id=? AND choice_id=?", (slot_id, choice["id"])).fetchone()[0]
            if got >= choice["need"]:
                raise Invalid(f"Someone just took {choice['title']}. Pick another.", "choice")
        reminders, news = email_prefs(body)
        sid = c.execute("INSERT INTO signups(slot_id, name, email, phone, qty, item, servings, choice_id, reminders, news, token, created) "
                        "VALUES (?,?,?,?,?,?,?,?,?,?,?,?)", (slot_id, name, email, clean(body.get("phone"), 30), qty, item, servings,
                                                              choice["id"] if choice else None, reminders, news, tok, db.now_iso())).lastrowid
        c.commit()
    except Exception:
        c.rollback()
        raise
    ev = db.one("SELECT * FROM events WHERE id=?", (sheet["event_id"],)) if sheet["event_id"] else None
    rows = [("Sign-up", sheet["title"]), ("Slot", slot["title"] + (f" ×{qty}" if qty > 1 else "")), ("Bringing", item),
            ("Serves", f"About {servings}" if servings else "")]
    if slot["starts_at"]:
        rows.append(("Time", fmt_slot_time(slot)))
    if ev:
        rows += [("Event", ev["title"]), ("When", mailer.fmt_when(ev)), ("Where", ev["location"])]
    confirm_email(email, name, tok, f"You're signed up: {slot['title']}", rows, ev)
    if news:
        subscribe(email, name, "sign-up")
    return {"id": sid}


def email_prefs(body):
    """Reminders default on (older clients don't send the field). Club news is opt-in only."""
    reminders = 0 if body.get("reminders") in (False, 0, "0", "false", "off") else 1
    if "news" not in body:
        return reminders, None  # older form: no answer either way
    news = 1 if body.get("news") in (True, 1, "1", "true", "on") else 0
    return reminders, news


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
    reminders, news = email_prefs(body)
    if existing:
        db.run("UPDATE rsvps SET status=?, guests=?, reminders=?, news=? WHERE id=?", (status, guests, reminders, news, existing["id"]))
    else:
        db.run("INSERT INTO rsvps(event_id, name, email, guests, status, reminders, news, token, created) VALUES (?,?,?,?,?,?,?,?,?)",
               (ev["id"], name, email, guests, status, reminders, news, tok, db.now_iso()))
    if news:
        subscribe(email, name, "rsvp")
    if status == "going":
        rows = [("When", mailer.fmt_when(ev)), ("Where", ev["location"]),
                ("Guests", f"You + {guests}" if guests else "")]
        confirm_email(email, name, tok, f"You're going to {ev['title']}", rows, ev)
    return {"status": status, "going": going_count(ev["id"])}


def subscribe(email, name="", source=""):
    """Add someone to the mailing list. Anyone newly added (or re-added) gets a short note saying so,
    with an unsubscribe link, so no one ends up on the list without knowing."""
    email = need_email(email)
    r = db.one("SELECT * FROM subscribers WHERE email=?", (email,))
    if r:
        if not r["active"]:
            db.run("UPDATE subscribers SET active=1 WHERE id=?", (r["id"],))
            welcome(email, r["name"] or name, r["token"], source)
        return r["token"]
    tok = db.token()
    db.run("INSERT INTO subscribers(name, email, token, source, created) VALUES (?,?,?,?,?)",
           (clean(name, 80), email, tok, source, db.now_iso()))
    welcome(email, name, tok, source)
    return tok


def welcome(email, name, tok, source):
    # One note per address per day at most, so the public form can't be used to flood someone's inbox.
    since = (db.now_local() - timedelta(days=1)).isoformat()
    if db.one("SELECT 1 FROM outbox WHERE to_email=? AND kind='welcome' AND created > ?", (email, since)):
        return
    club = db.get_setting("club_name") or "Mahina Club"
    first = (clean(name, 80).split() or [""])[0]
    lead = (f"An organizer added you to the {club} email list." if source == "admin"
            else f"You're on the {club} email list.")
    h, t = mailer.render(f"You're on the {club} list", [
        f"Aloha{', ' + first if first else ''}. {lead}",
        "We send event invites and club news, usually a few times a month.",
        "Didn't sign up, or added by mistake? Use the Unsubscribe link below and you won't get club emails. "
        "That page can also delete your info completely."],
        button=("See what's coming up", f"{mailer.site_url()}/events"),
        footer_link=("Unsubscribe", f"{mailer.site_url()}/unsubscribe/{tok}"))
    mailer.queue(email, f"You're on the {club} email list", h, t, kind="welcome")


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
