"""Shop: products, orders, Venmo pay links, and optional payment matching from Venmo's emails.

Every order gets a short code (MC-7Q4K2). The Venmo link fills in the club, the exact amount, and that code as the
note, so a payment can be matched to its order by eye or automatically. The automatic part reads the club's
"paid you" emails from Venmo over IMAP (read-only) and marks an order paid when the code and the amount both match.
"""
import email
import email.header
import imaplib
import json
import re
import secrets
import ssl
from datetime import datetime, timedelta
from email.utils import parseaddr
from html import unescape
from urllib.parse import quote

from fastapi import APIRouter, Body, HTTPException, Request

from . import db, mailer, store
from .admin import audit, can, csv_response
from .store import Invalid, clean

public = APIRouter(prefix="/api/shop")
team = APIRouter(prefix="/api/admin/shop")

CODE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"  # no I, L, O, 0, 1: easy to read aloud and retype
CODE_RE = re.compile(r"\bMC-?([A-HJKMNP-Z2-9]{5})\b", re.I)
AMOUNT_RE = re.compile(r"\$\s?(\d{1,3}(?:,\d{3})*|\d+)\.(\d{2})\b")
MAX_PRICE = 1_000_000  # $10,000 in cents
MASK = "••••••••"


def enabled():
    return bool(db.get_setting("shop_enabled"))


def fmt(cents):
    return f"${cents / 100:,.2f}"


def cents(v, field="price"):
    s = str(v if v is not None else "").replace("$", "").replace(",", "").strip()
    if not re.fullmatch(r"\d{1,5}(\.\d{1,2})?", s):
        raise Invalid("Enter a price like 20 or 12.50.", field)
    c = round(float(s) * 100)
    if c > MAX_PRICE:
        raise Invalid("That price is too high.", field)
    return c


def venmo_handle():
    return (db.get_setting("venmo") or "").lstrip("@")


def pay_link(o):
    note = (db.get_setting("club_name") or "Mahina Club") + " order " + o["code"]
    return (f"https://venmo.com/?txn=pay&recipients={quote(venmo_handle())}&amount={o['total'] / 100:.2f}"
            f"&note={quote(note)}&audience=private")


# ---------- products ----------

def _json(s, default):
    try:
        return json.loads(s) if s else default
    except ValueError:
        return default


def product_out(p, admin=False):
    options = _json(p["options"], [])
    stock = _json(p["stock"], {})
    keys = options or [""]
    photo = store.photo_out(db.one("SELECT * FROM photos WHERE id=?", (p["photo_id"],))) if p["photo_id"] else None
    out = {"id": p["id"], "name": p["name"], "description": p["description"] or "", "price": p["price"], "options": options,
           "photo": photo, "left": {k: stock.get(k) for k in keys}}
    out["sold_out"] = all(isinstance(v, int) and v <= 0 for v in out["left"].values())
    if admin:
        out.update(active=bool(p["active"]), sort=p["sort"], photo_id=p["photo_id"], tracked=any(v is not None for v in out["left"].values()))
    return out


def product_fields(body):
    name = clean(body.get("name"), 80)
    if not name:
        raise Invalid("Give it a name.", "name")
    options = []
    for o in body.get("options") or []:
        o = clean(o, 24)
        if o and o not in options:
            options.append(o)
    options = options[:20]
    stock = {}
    raw = body.get("stock") or {}
    for k in options or [""]:
        v = raw.get(k)
        if v in (None, ""):
            continue
        if not str(v).strip().isdigit() or int(v) > 99999:
            raise Invalid(f"Stock for {k or 'this item'} should be a whole number, or blank to not count it.", "stock")
        stock[k] = int(v)
    pid = body.get("photo_id")
    return {"name": name, "description": clean(body.get("description"), 600, multiline=True), "price": cents(body.get("price")),
            "options": json.dumps(options), "stock": json.dumps(stock), "active": 1 if body.get("active", True) else 0,
            "photo_id": int(pid) if str(pid or "").isdigit() else None}


def products(admin=False):
    rows = db.q("SELECT * FROM products " + ("" if admin else "WHERE active=1 ") + "ORDER BY sort, id")
    return [product_out(p, admin) for p in rows]


# ---------- orders ----------

def new_code(c):
    while True:
        code = "MC-" + "".join(secrets.choice(CODE_CHARS) for _ in range(5))
        if not c.execute("SELECT 1 FROM orders WHERE code=?", (code,)).fetchone():
            return code


def _begin():
    c = db.conn()
    if c.in_transaction:
        c.commit()
    c.execute("BEGIN IMMEDIATE")
    return c


def reserve(c, items, active_only=True):
    """Check the cart against the shelf and take the items off it. Runs inside the caller's write lock."""
    want = {}
    for it in (items or [])[:30]:
        try:
            pid, qty = int(it.get("product_id")), int(it.get("qty") or 1)
        except (TypeError, ValueError):
            raise Invalid("Something in the cart isn't right. Refresh and try again.")
        key = (pid, clean(it.get("option"), 24))
        want[key] = want.get(key, 0) + max(0, min(qty, 50))
    want = {k: q for k, q in want.items() if q > 0}
    if not want:
        raise Invalid("The cart is empty.")
    lines, total, cache = [], 0, {}
    for (pid, opt), qty in want.items():
        p = cache.get(pid) or c.execute("SELECT * FROM products WHERE id=?", (pid,)).fetchone()
        if not p or (active_only and not p["active"]):
            raise Invalid("Something in the cart isn't for sale anymore. Refresh and try again.")
        cache[pid] = p
        options, stock = _json(p["options"], []), _json(p["stock"], {})
        if options and opt not in options:
            raise Invalid(f"Pick a size for {p['name']}.")
        if not options:
            opt = ""
        if isinstance(stock.get(opt), int):
            if stock[opt] < qty:
                left = stock[opt]
                label = p["name"] + (f" ({opt})" if opt else "")
                raise Invalid(f"{label} is sold out." if left <= 0 else f"Only {left} left of {label}.")
            stock[opt] -= qty
            c.execute("UPDATE products SET stock=? WHERE id=?", (json.dumps(stock), pid))
            cache[pid] = c.execute("SELECT * FROM products WHERE id=?", (pid,)).fetchone()
        lines.append({"product_id": pid, "name": p["name"], "option": opt, "qty": qty, "price": p["price"]})
        total += p["price"] * qty
    return lines, total


def restock(c, lines):
    for ln in lines:
        p = c.execute("SELECT stock FROM products WHERE id=?", (ln["product_id"],)).fetchone()
        if not p:
            continue
        stock = _json(p["stock"], {})
        if isinstance(stock.get(ln["option"]), int):
            stock[ln["option"]] += ln["qty"]
            c.execute("UPDATE products SET stock=? WHERE id=?", (json.dumps(stock), ln["product_id"]))


def line_text(ln):
    return f"{ln['qty']}× {ln['name']}" + (f" ({ln['option']})" if ln["option"] else "")


def order_out(o, admin=False):
    items = _json(o["items"], [])
    out = {"code": o["code"], "status": o["status"], "total": o["total"], "items": items, "created": o["created"],
           "paid": o["status"] == "paid", "picked_up": bool(o["picked_up_at"]), "channel": o["channel"]}
    if o["status"] == "pending" and venmo_handle():
        out["venmo"] = {"handle": venmo_handle(), "link": pay_link(o)}
    if admin:
        out.update(id=o["id"], name=o["name"], email=o["email"], method=o["method"], note=o["note"], paid_at=o["paid_at"],
                   paid_by=o["paid_by"], picked_up_at=o["picked_up_at"], sent_to=_json(o.get("sent_to"), []))
    else:
        out["pickup"] = db.get_setting("shop_note") or ""
    return out


def create_order(body, channel, by=None):
    online = channel == "online"
    name = store.need_name(body.get("name")) if online else clean(body.get("name"), 80)
    em = store.need_email(body.get("email")) if online or body.get("email") else ""
    method = body.get("method") if body.get("method") in ("venmo", "cash") else "venmo"
    if method == "venmo" and not venmo_handle():
        raise Invalid("Add the club's Venmo handle in Settings first." if by else "Online orders aren't open yet.")
    c = _begin()
    try:
        lines, total = reserve(c, body.get("items"))
        code = new_code(c)
        paid = method == "cash" or total == 0
        now = db.now_iso()
        oid = c.execute("INSERT INTO orders(code, name, email, items, total, status, method, channel, created, paid_at, paid_by, picked_up_at) "
                        "VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
                        (code, name, em, json.dumps(lines), total, "paid" if paid else "pending", method if not online else "",
                         channel, now, now if paid else None, by["name"] if paid and by else "",
                         now if paid and not online else None)).lastrowid
        c.commit()
    except Exception:
        c.rollback()
        raise
    o = db.one("SELECT * FROM orders WHERE id=?", (oid,))
    if online:
        order_email(o, "placed")
        alert_team(o, "new")
    return o


def shop_sender():
    """The shop's own From and Reply-To, when an admin set them. Otherwise shop email goes out like any club email."""
    m = db.get_setting("shop_mail") or {}
    if not (m.get("from") or m.get("reply_to") or m.get("from_name")):
        return None
    return {"name": m.get("from_name") or "", "from": m.get("from") or "", "reply_to": m.get("reply_to") or m.get("from") or ""}


def shop_people():
    """Accounts that can see the shop. Order emails to the team carry the buyer's details, so only these people get them."""
    return [r for r in db.q("SELECT id, name, email, role, perms FROM admins ORDER BY name COLLATE NOCASE")
            if r["role"] == "admin" or "shop" in _json(r["perms"], [])]


def status_text(o):
    if o["status"] == "pending":
        return "Waiting for payment"
    if o["status"] == "cancelled":
        return "Cancelled"
    return "Paid, handed out" if o["picked_up_at"] else "Paid, to hand out"


def team_email(o, people, title, lead, note="", reply_to=""):
    rows = [("Order", o["code"]), ("Status", status_text(o)), ("Items", ", ".join(line_text(i) for i in _json(o["items"], []))),
            ("Total", fmt(o["total"])), ("Paid with", {"cash": "Cash", "venmo": "Venmo"}.get(o["method"], "")),
            ("Name", o["name"]), ("Email", o["email"]), ("Where", "Online" if o["channel"] == "online" else "At the table")]
    blocks = [lead] + ([f"Note: {note}"] if note else []) + [("rows", rows)]
    h, t = mailer.render(title, blocks, button=("Open in Shop", f"{mailer.site_url()}/team/shop?tab=orders&order={o['code']}"))
    sender = shop_sender() or {}
    if reply_to:
        sender = {**sender, "reply_to": reply_to}
    for p in people:
        mailer.queue(p["email"], title, h, t, kind="order-team", sender=sender or None)


def alert_team(o, kind):
    """Email the people an admin picked whenever an online order comes in or gets paid."""
    ids = set(db.get_setting("shop_notify") or [])
    people = [p for p in shop_people() if p["id"] in ids]
    if not people:
        return
    if kind == "new":
        team_email(o, people, f"New order {o['code']}: {fmt(o['total'])}", f"{o['name'] or 'Someone'} placed an order online.")
    else:
        how = "Matched from Venmo's email." if o["paid_by"] == "Venmo email" else f"Marked paid by {o['paid_by']}."
        team_email(o, people, f"Paid: order {o['code']}", f"{o['name'] or 'An order'} is paid and ready to hand out. {how}")


def order_email(o, kind):
    if not o["email"]:
        return
    items = _json(o["items"], [])
    pickup = db.get_setting("shop_note") or ""
    rows = [("Order", o["code"]), ("Items", ", ".join(line_text(i) for i in items)), ("Total", fmt(o["total"]))]
    first = (o["name"].split() or [""])[0]
    url = f"{mailer.site_url()}/shop/order/{o['code']}"
    if kind == "placed":
        h, t = mailer.render(f"Order {o['code']}", [f"Mahalo{', ' + first if first else ''}.", ("rows", rows),
                                                    f"Pay {fmt(o['total'])} with Venmo to @{venmo_handle()} and keep {o['code']} in the note.",
                                                    *([pickup] if pickup else [])],
                             button=("Pay with Venmo", pay_link(o)), footer_link=("View your order", url))
        mailer.queue(o["email"], f"Your order {o['code']}", h, t, kind="order", sender=shop_sender())
    elif kind == "paid":
        h, t = mailer.render("Payment received", [f"Mahalo{', ' + first if first else ''}. Your order is paid.", ("rows", rows),
                                                  *([pickup] if pickup else [])], footer_link=("View your order", url))
        mailer.queue(o["email"], f"Paid: order {o['code']}", h, t, kind="order", sender=shop_sender())
    elif kind == "cancelled":
        h, t = mailer.render(f"Order {o['code']} cancelled", [("rows", rows),
                                                              "If you already paid, reply to this email and we'll sort it out."])
        mailer.queue(o["email"], f"Cancelled: order {o['code']}", h, t, kind="order", sender=shop_sender())


def mark_paid(o, method, by_name):
    now = db.now_iso()
    # A table sale is handed over on the spot; an online order waits for pickup.
    db.run("UPDATE orders SET status='paid', method=?, paid_at=?, paid_by=?, picked_up_at=? WHERE id=? AND status='pending'",
           (method, now, by_name, now if o["channel"] == "table" else None, o["id"]))
    o = db.one("SELECT * FROM orders WHERE id=?", (o["id"],))
    if o["channel"] == "online":
        order_email(o, "paid")
        alert_team(o, "paid")
    return o


def change(o, action, user, method=""):
    """Team actions on an order: paid, picked_up, not_picked_up, cancel."""
    if action == "paid":
        if o["status"] != "pending":
            raise Invalid("Only orders waiting for payment can be marked paid.")
        return mark_paid(o, method if method in ("venmo", "cash") else "venmo", user["name"])
    if action in ("picked_up", "not_picked_up"):
        if o["status"] != "paid":
            raise Invalid("Mark it paid first.")
        db.run("UPDATE orders SET picked_up_at=? WHERE id=?", (db.now_iso() if action == "picked_up" else None, o["id"]))
    elif action == "cancel":
        if o["status"] == "cancelled":
            return o
        c = _begin()
        try:
            if not o["picked_up_at"]:
                restock(c, _json(o["items"], []))
            c.execute("UPDATE orders SET status='cancelled' WHERE id=?", (o["id"],))
            c.commit()
        except Exception:
            c.rollback()
            raise
        if o["channel"] == "online" and o["status"] == "pending":
            order_email(o, "cancelled")
    else:
        raise Invalid("Unknown action.")
    return db.one("SELECT * FROM orders WHERE id=?", (o["id"],))


def expire_stale(c, cutoff):
    """Cancel orders still waiting for payment after the cutoff and put their items back. Called from db.prune()."""
    for o in c.execute("SELECT * FROM orders WHERE status='pending' AND created < ?", (cutoff,)).fetchall():
        restock(c, _json(o["items"], []))
        c.execute("UPDATE orders SET status='cancelled', note=TRIM(note || ' Cancelled: not paid in 14 days.') WHERE id=?", (o["id"],))


def stats():
    paid = db.q("SELECT * FROM orders WHERE status='paid'")
    today = db.now_iso()[:10]
    by_method = {}
    units = {}
    for o in paid:
        m = o["method"] or "venmo"
        by_method[m] = by_method.get(m, 0) + o["total"]
        for ln in _json(o["items"], []):
            k = ln["name"] + (f" ({ln['option']})" if ln["option"] else "")
            units[k] = units.get(k, 0) + ln["qty"]
    return {"total": sum(o["total"] for o in paid), "count": len(paid), "venmo": by_method.get("venmo", 0), "cash": by_method.get("cash", 0),
            "today": sum(o["total"] for o in paid if (o["paid_at"] or "")[:10] == today),
            "waiting": db.one("SELECT COUNT(*) n FROM orders WHERE status='pending'")["n"],
            "to_hand_out": db.one("SELECT COUNT(*) n FROM orders WHERE status='paid' AND picked_up_at IS NULL")["n"],
            "units": sorted(({"item": k, "qty": v} for k, v in units.items()), key=lambda x: -x["qty"])}


# ---------- Venmo email matching ----------

IMAP_STATUS = {"at": None, "ok": None, "message": ""}


def match_venmo_text(text):
    """Order codes and dollar amounts (in cents) found in an email's text."""
    codes = {"MC-" + m.upper() for m in CODE_RE.findall(text or "")}
    amounts = {int(a.replace(",", "")) * 100 + int(b) for a, b in AMOUNT_RE.findall(text or "")}
    return codes, amounts


def _text_of(msg):
    parts = []
    for part in msg.walk() if msg.is_multipart() else [msg]:
        ctype = part.get_content_type()
        if ctype not in ("text/plain", "text/html") or part.get_filename():
            continue
        try:
            body = part.get_payload(decode=True).decode(part.get_content_charset() or "utf-8", "replace")
        except Exception:
            continue
        if ctype == "text/html":
            body = re.sub(r"(?is)<(script|style).*?</\1>", " ", body)
            body = unescape(re.sub(r"<[^>]+>", " ", body))
        parts.append(body)
    return re.sub(r"\s+", " ", " ".join(parts))


def from_venmo(msg):
    """From venmo.com, with the receiving mail server's own DKIM check passing for venmo.com."""
    addr = parseaddr(msg.get("From", ""))[1].lower()
    if not re.search(r"@([\w-]+\.)*venmo\.com$", addr):
        return False
    results = msg.get_all("Authentication-Results") or []
    # Only the topmost header is the receiving server's. Anything below it came with the message and could be forged.
    return bool(results) and bool(re.search(r"dkim=pass[^;]*header\.(d|i)=@?([\w-]+\.)*venmo\.com", results[0], re.I))


def is_received_payment(subject):
    s = (subject or "").lower()
    return "paid you" in s or ("received" in s and "request" not in s)


def apply_venmo_email(msg):
    """Mark the matching order paid. Returns the order code, or None."""
    if not from_venmo(msg):
        return None
    subject = str(email.header.make_header(email.header.decode_header(msg.get("Subject", ""))))
    if not is_received_payment(subject):
        return None
    codes, amounts = match_venmo_text(subject + " " + _text_of(msg))
    for code in codes:
        o = db.one("SELECT * FROM orders WHERE code=?", (code,))
        if not o or o["status"] != "pending":
            continue
        if o["total"] in amounts:
            mark_paid(o, "venmo", "Venmo email")
            audit(None, "Venmo payment matched", f"{code}, {fmt(o['total'])}", ip="")
            return code
        note = f"Venmo email for {code} didn't show {fmt(o['total'])}. Check Venmo."
        if note not in (o["note"] or ""):
            db.run("UPDATE orders SET note=TRIM(note || ' ' || ?) WHERE id=?", (note, o["id"]))
    return None


def imap_config():
    s = db.get_setting("shop_imap") or {}
    return {k: s.get(k) or "" for k in ("host", "user", "password", "folder")}


def check_venmo_mail(force=False):
    """Read recent Venmo emails (read-only) and match payments to orders waiting for them."""
    cfg = imap_config()
    if not (cfg["host"] and cfg["user"] and cfg["password"]):
        return IMAP_STATUS
    if not force and not db.one("SELECT 1 FROM orders WHERE status='pending' LIMIT 1"):
        return IMAP_STATUS
    host, _, port = cfg["host"].partition(":")
    matched = []
    try:
        with imaplib.IMAP4_SSL(host, int(port or 993), ssl_context=ssl.create_default_context(), timeout=20) as m:
            m.login(cfg["user"], cfg["password"])
            typ, _ = m.select(f'"{cfg["folder"] or "INBOX"}"', readonly=True)
            if typ != "OK":
                raise RuntimeError(f"Couldn't open the folder {cfg['folder'] or 'INBOX'}.")
            since = (datetime.now() - timedelta(days=3)).strftime("%d-%b-%Y")
            typ, data = m.search(None, f'(FROM "venmo.com" SINCE {since})')
            ids = (data[0] or b"").split()[-60:]
            for i in ids:
                typ, parts = m.fetch(i, "(BODY.PEEK[])")
                raw = next((p[1] for p in parts if isinstance(p, tuple)), None)
                if raw:
                    code = apply_venmo_email(email.message_from_bytes(raw))
                    if code:
                        matched.append(code)
        IMAP_STATUS.update(at=db.now_iso(), ok=True,
                           message=f"Checked {len(ids)} Venmo email{'s' if len(ids) != 1 else ''}" + (f", matched {', '.join(matched)}." if matched else "."))
    except Exception as e:
        msg = str(e)
        if isinstance(e, imaplib.IMAP4.error) or "AUTHENTICATIONFAILED" in msg.upper():
            msg = "Sign-in failed. Check the username and app password."
        IMAP_STATUS.update(at=db.now_iso(), ok=False, message=msg[:200])
    return IMAP_STATUS


# ---------- public API ----------

def _public_on():
    if not enabled():
        raise HTTPException(404)


def _throttle(request, bucket, limit, window=300):
    from .main import throttle
    throttle(request, bucket, limit, window)


@public.get("")
def shop_home():
    _public_on()
    return {"title": db.get_setting("shop_title") or "Shop", "note": db.get_setting("shop_note") or "",
            "products": products(), "venmo": bool(venmo_handle())}


@public.post("/orders")
def place_order(request: Request, body: dict = Body(...)):
    _public_on()
    if body.get("website"):
        raise Invalid("Couldn't submit that form.")
    _throttle(request, "order", 8, 900)
    o = create_order(body, "online")
    if body.get("news") in (True, 1, "1", "true", "on"):
        store.subscribe(o["email"], o["name"], "shop")
    return order_out(o)


def _by_code(code):
    o = db.one("SELECT * FROM orders WHERE code=?", (clean(code, 12).upper(),))
    if not o:
        raise Invalid("We couldn't find that order.", status=404)
    return o


@public.get("/orders/{code}")
def order_status(code: str, request: Request):
    _public_on()
    _throttle(request, "order-look", 120)
    return order_out(_by_code(code))


@public.get("/orders/{code}/qr.svg")
def order_qr(code: str, request: Request):
    _public_on()
    _throttle(request, "order-look", 120)
    o = _by_code(code)
    if o["status"] != "pending" or not venmo_handle():
        raise HTTPException(404)
    from .main import qr_svg
    return qr_svg(pay_link(o))


# ---------- team API ----------

SHOP = can("shop")
ADMIN = can()


def settings_out():
    s = db.all_settings()
    imap = dict(s.get("shop_imap") or {})
    imap["password"] = MASK if imap.get("password") else ""
    return {"enabled": bool(s.get("shop_enabled")), "title": s.get("shop_title") or "Shop", "note": s.get("shop_note") or "",
            "imap": imap, "imap_status": IMAP_STATUS, "mail": {**db.DEFAULT_SETTINGS["shop_mail"], **(s.get("shop_mail") or {})},
            "notify": [i for i in (s.get("shop_notify") or []) if i in {p["id"] for p in shop_people()}]}


@team.get("")
def team_home(a=SHOP):
    out = {"products": products(admin=True), "stats": stats(), "venmo": venmo_handle(), "enabled": enabled(),
           "people": [{"id": p["id"], "name": p["name"]} for p in shop_people()]}
    if a["role"] == "admin":
        out["settings"] = settings_out()
    return out


@team.put("/settings")
def team_settings(body: dict = Body(...), a=ADMIN):
    changed = []
    if "enabled" in body:
        db.set_setting("shop_enabled", bool(body["enabled"]))
        changed.append("shown on site" if body["enabled"] else "hidden")
    if "title" in body:
        db.set_setting("shop_title", clean(body["title"], 40) or "Shop")
        changed.append("title")
    if "note" in body:
        db.set_setting("shop_note", clean(body["note"], 300, multiline=True))
        changed.append("pickup note")
    if "imap" in body:
        cur = db.get_setting("shop_imap") or {}
        raw = body["imap"] or {}
        host = clean(raw.get("host"), 200)
        if host and not re.fullmatch(r"[A-Za-z0-9.-]+(:\d{2,5})?", host):
            raise Invalid("Enter just the server name, like imap.gmail.com.", "imap_host")
        new = {"host": host, "user": clean(raw.get("user"), 200), "folder": clean(raw.get("folder"), 80) or "INBOX",
               "password": cur.get("password", "") if raw.get("password") == MASK else str(raw.get("password") or "")[:500]}
        db.set_setting("shop_imap", new)
        changed.append("Venmo email check")
    if "mail" in body:
        raw = body["mail"] or {}
        new = {"from_name": clean(raw.get("from_name"), 80)}
        for k in ("from", "reply_to"):
            v = clean(raw.get(k), 200).lower()
            if v and not store.EMAIL_RE.match(v):
                raise Invalid("Enter an email address like shop@example.com.", "mail_" + k)
            new[k] = v
        db.set_setting("shop_mail", new)
        changed.append("shop email address")
    if "notify" in body:
        ok = {p["id"] for p in shop_people()}
        db.set_setting("shop_notify", sorted({int(i) for i in body["notify"] or [] if str(i).isdigit() and int(i) in ok}))
        changed.append("order alerts")
    if changed:
        audit(a, "Changed shop settings", ", ".join(changed))
    return settings_out()


@team.post("/check-mail")
def team_check_mail(a=ADMIN):
    return check_venmo_mail(force=True)


@team.post("/products")
def product_create(body: dict = Body(...), a=SHOP):
    f = product_fields(body)
    sort = (db.one("SELECT MAX(sort) m FROM products")["m"] or 0) + 1
    pid = db.run("INSERT INTO products(name, description, price, options, stock, active, photo_id, sort, created) VALUES (?,?,?,?,?,?,?,?,?)",
                 (f["name"], f["description"], f["price"], f["options"], f["stock"], f["active"], f["photo_id"], sort, db.now_iso()))
    audit(a, "Added a product", f["name"])
    return product_out(db.one("SELECT * FROM products WHERE id=?", (pid,)), admin=True)


def _product(pid):
    p = db.one("SELECT * FROM products WHERE id=?", (pid,))
    if not p:
        raise Invalid("That product no longer exists.", status=404)
    return p


@team.put("/products/{pid}")
def product_update(pid: int, body: dict = Body(...), a=SHOP):
    _product(pid)
    f = product_fields(body)
    db.run("UPDATE products SET name=?, description=?, price=?, options=?, stock=?, active=?, photo_id=? WHERE id=?",
           (f["name"], f["description"], f["price"], f["options"], f["stock"], f["active"], f["photo_id"], pid))
    audit(a, "Edited a product", f["name"])
    return product_out(_product(pid), admin=True)


@team.post("/products/order")
def product_sort(body: dict = Body(...), a=SHOP):
    for i, pid in enumerate(body.get("ids") or []):
        if str(pid).isdigit():
            db.run("UPDATE products SET sort=? WHERE id=?", (i, int(pid)))
    return {"ok": True}


@team.delete("/products/{pid}")
def product_delete(pid: int, a=SHOP):
    p = _product(pid)
    db.run("DELETE FROM products WHERE id=?", (pid,))
    audit(a, "Deleted a product", p["name"])
    return {"ok": True}


ORDER_VIEWS = {"open": "status='pending' OR (status='paid' AND picked_up_at IS NULL)", "waiting": "status='pending'",
               "hand_out": "status='paid' AND picked_up_at IS NULL", "paid": "status='paid'", "all": "1=1"}


@team.get("/orders")
def orders(view: str = "open", a=SHOP):
    where = ORDER_VIEWS.get(view, ORDER_VIEWS["open"])
    return [order_out(o, admin=True) for o in db.q(f"SELECT * FROM orders WHERE {where} ORDER BY id DESC LIMIT 500")]


@team.post("/orders")
def sell(body: dict = Body(...), a=SHOP):
    o = create_order(body, "table", by=a)
    audit(a, "Sold at the table" if o["status"] == "paid" else "Started a Venmo sale", f"{o['code']}, {fmt(o['total'])}")
    return order_out(o, admin=True)


def _order(oid):
    o = db.one("SELECT * FROM orders WHERE id=?", (oid,))
    if not o:
        raise Invalid("That order no longer exists.", status=404)
    return o


@team.get("/orders/{oid}")
def order(oid: int, a=SHOP):
    return order_out(_order(oid), admin=True)


@team.get("/orders/{oid}/qr.svg")
def team_order_qr(oid: int, a=SHOP):
    o = _order(oid)
    if o["status"] != "pending" or not venmo_handle():
        raise HTTPException(404)
    from .main import qr_svg
    return qr_svg(pay_link(o))


ACTION_NAMES = {"paid": "Marked an order paid", "picked_up": "Handed out an order", "not_picked_up": "Undid hand-out",
                "cancel": "Cancelled an order"}


@team.post("/orders/{oid}/status")
def order_change(oid: int, body: dict = Body(...), a=SHOP):
    o = _order(oid)
    action = body.get("action")
    o = change(o, action, a, body.get("method") or "")
    audit(a, ACTION_NAMES.get(action, "Changed an order"), f"{o['code']}" + (f", {body.get('method')}" if action == "paid" else ""))
    return order_out(o, admin=True)


@team.post("/orders/{oid}/send")
def order_send(oid: int, body: dict = Body(...), a=SHOP):
    """Email an order to chosen team members, with an optional note. Replies go to whoever sent it."""
    o = _order(oid)
    people = {p["id"]: p for p in shop_people()}
    to = [people[int(i)] for i in (body.get("to") or [])[:20] if str(i).isdigit() and int(i) in people]
    if not to:
        raise Invalid("Pick who to send it to.", "to")
    note = clean(body.get("note"), 1000, multiline=True)
    me = db.one("SELECT email FROM admins WHERE id=?", (a["id"],))
    team_email(o, to, f"Order {o['code']}: {status_text(o).lower()}", f"{a['name']} sent you this order.", note,
               reply_to=me["email"] if me else "")
    log = _json(o.get("sent_to"), [])[-19:] + [{"at": db.now_iso(), "by": a["name"], "to": [p["name"] for p in to], "note": note}]
    db.run("UPDATE orders SET sent_to=? WHERE id=?", (json.dumps(log), oid))
    audit(a, "Sent an order to the team", f"{o['code']} to {', '.join(p['name'] for p in to)}")
    return order_out(_order(oid), admin=True)


@team.get("/orders.csv")
def orders_csv(a=SHOP):
    audit(a, "Exported shop orders")
    rows = [[o["code"], o["created"][:16].replace("T", " "), o["status"], "Yes" if o["picked_up_at"] else "", o["channel"],
             o["method"], o["name"], o["email"], "; ".join(line_text(i) for i in _json(o["items"], [])), f"{o['total'] / 100:.2f}",
             (o["paid_at"] or "")[:16].replace("T", " "), o["paid_by"], o["note"]]
            for o in db.q("SELECT * FROM orders ORDER BY id")]
    return csv_response("shop-orders.csv", ["Order", "Placed", "Status", "Handed out", "Where", "Paid with", "Name", "Email", "Items",
                                            "Total", "Paid at", "Confirmed by", "Note"], rows)
