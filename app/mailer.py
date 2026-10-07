"""Email: templates, calendar files, and an outbox worker.

Mail goes out over plain SMTP, so any provider works (Brevo, Resend, SendGrid,
Postmark, Mailgun, Google Workspace). Settings come from the environment first
(SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD, SMTP_FROM, SMTP_SECURITY), then
from Admin > Settings. With no SMTP configured, messages are held in the outbox
so nothing is lost; they send once SMTP is set up.
"""
import html as htmlmod
import json
import os
import smtplib
import ssl
import threading
import time
from datetime import datetime, timedelta
from email.message import EmailMessage
from email.utils import formataddr, make_msgid
from zoneinfo import ZoneInfo

from . import db


# ---------- settings ----------

def smtp_config():
    s = db.get_setting("smtp") or {}
    cfg = {
        "host": os.environ.get("SMTP_HOST") or s.get("host", ""),
        "port": int(os.environ.get("SMTP_PORT") or s.get("port") or 587),
        "user": os.environ.get("SMTP_USER") or s.get("user", ""),
        "password": os.environ.get("SMTP_PASSWORD") or s.get("password", ""),
        "from": os.environ.get("SMTP_FROM") or s.get("from", ""),
        "security": os.environ.get("SMTP_SECURITY") or s.get("security", "starttls"),
    }
    cfg["ready"] = bool(cfg["host"] and cfg["from"])
    cfg["from_env"] = bool(os.environ.get("SMTP_HOST"))
    return cfg


def site_url():
    return (os.environ.get("SITE_URL") or db.get_setting("site_url") or "http://localhost:8080").rstrip("/")


def tz():
    try:
        return ZoneInfo(db.get_setting("timezone") or "Pacific/Honolulu")
    except Exception:
        return ZoneInfo("Pacific/Honolulu")


# ---------- calendar ----------

def _ics_escape(s):
    return (s or "").replace("\\", "\\\\").replace(";", "\\;").replace(",", "\\,").replace("\n", "\\n")


def _fold(line):
    out, b = [], line.encode()
    while len(b) > 74:
        cut = 74
        while (b[cut] & 0xC0) == 0x80:
            cut -= 1
        out.append(b[:cut].decode())
        b = b" " + b[cut:]
    out.append(b.decode())
    return "\r\n".join(out)


def _utc(local_iso):
    dt = datetime.fromisoformat(local_iso).replace(tzinfo=tz())
    return dt.astimezone(ZoneInfo("UTC")).strftime("%Y%m%dT%H%M%SZ")


def event_vevent(ev):
    start = ev["starts_at"]
    end = ev.get("ends_at") or (datetime.fromisoformat(start) + timedelta(hours=2)).isoformat()
    lines = ["BEGIN:VEVENT", f"UID:event-{ev['id']}@mahina-club", f"DTSTAMP:{datetime.utcnow().strftime('%Y%m%dT%H%M%SZ')}"]
    if ev.get("all_day"):
        d0 = datetime.fromisoformat(start).date()
        d1 = datetime.fromisoformat(end).date() + timedelta(days=1)
        lines += [f"DTSTART;VALUE=DATE:{d0.strftime('%Y%m%d')}", f"DTEND;VALUE=DATE:{d1.strftime('%Y%m%d')}"]
    else:
        lines += [f"DTSTART:{_utc(start)}", f"DTEND:{_utc(end)}"]
    url = f"{site_url()}/events/{ev['slug']}"
    lines += [
        f"SUMMARY:{_ics_escape(ev['title'])}",
        f"LOCATION:{_ics_escape(ev.get('location', ''))}",
        f"DESCRIPTION:{_ics_escape((ev.get('summary') or '') + chr(10) + url)}",
        f"URL:{url}",
        "STATUS:CANCELLED" if ev.get("status") == "cancelled" else "STATUS:CONFIRMED",
        "END:VEVENT",
    ]
    return lines


def ics_for(events, name="Mahina Club"):
    lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Mahina Club//Events//EN", "CALSCALE:GREGORIAN",
             "METHOD:PUBLISH", f"X-WR-CALNAME:{_ics_escape(name)}"]
    for ev in events:
        lines += event_vevent(ev)
    lines.append("END:VCALENDAR")
    return "\r\n".join(_fold(l) for l in lines) + "\r\n"


# ---------- templates ----------

def fmt_day(iso):
    d = datetime.fromisoformat(iso)
    return d.strftime("%a, %b ") + str(d.day) + " at " + d.strftime("%I:%M %p").lstrip("0")


def fmt_when(ev):
    d = datetime.fromisoformat(ev["starts_at"])
    day = d.strftime("%A, %B ") + str(d.day)
    if ev.get("all_day"):
        return day
    t = d.strftime("%I:%M %p").lstrip("0")
    if ev.get("ends_at"):
        e = datetime.fromisoformat(ev["ends_at"])
        t += "–" + e.strftime("%I:%M %p").lstrip("0")
    return f"{day}, {t}"


def render(title, blocks, button=None, footer_link=None):
    """blocks: list of plain-text paragraphs or ('rows', [(label, value)])."""
    club = db.get_setting("club_name") or "Mahina Club"
    c = db.palette_colors()
    c_muted, c_ink, c_text, c_accent, c_mist, c_night, c_moon = (c[k] for k in ("muted", "ink", "text", "accent", "mist", "night", "moon"))
    esc = htmlmod.escape
    parts_html, parts_text = [], [title, ""]
    for b in blocks:
        if isinstance(b, tuple) and b[0] == "rows":
            rows = "".join(
                f'<tr><td style="padding:6px 16px 6px 0;color:{c_muted};font-size:14px;vertical-align:top;white-space:nowrap">{esc(k)}</td>'
                f'<td style="padding:6px 0;color:{c_ink};font-size:15px;font-weight:600">{esc(v)}</td></tr>'
                for k, v in b[1] if v)
            parts_html.append(f'<table role="presentation" style="border-collapse:collapse;margin:8px 0 20px">{rows}</table>')
            parts_text += [f"{k}: {v}" for k, v in b[1] if v] + [""]
        else:
            parts_html.append(f'<p style="margin:0 0 16px;font-size:16px;line-height:1.55;color:{c_text}">{esc(b)}</p>')
            parts_text += [b, ""]
    if button:
        parts_html.append(
            f'<p style="margin:24px 0 8px"><a href="{esc(button[1])}" style="display:inline-block;background:{c_accent};color:#fff;'
            f'text-decoration:none;font-weight:700;font-size:15px;padding:12px 22px;border-radius:999px">{esc(button[0])}</a></p>')
        parts_text += [f"{button[0]}: {button[1]}", ""]
    foot = ""
    if footer_link:
        foot = f'<a href="{esc(footer_link[1])}" style="color:{c_muted}">{esc(footer_link[0])}</a>'
        parts_text += [f"{footer_link[0]}: {footer_link[1]}"]
    html_out = f"""<!doctype html><html><body style="margin:0;background:{c_mist};font-family:'Public Sans',-apple-system,Segoe UI,Helvetica,Arial,sans-serif">
<table role="presentation" width="100%" style="border-collapse:collapse"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" style="max-width:560px;border-collapse:collapse;background:#fff">
<tr><td style="background:{c_night};padding:22px 28px"><span style="display:inline-block;width:14px;height:14px;border-radius:50%;background:{c_moon};vertical-align:-1px;margin-right:10px"></span><span style="color:#fff;font-weight:800;font-size:17px;letter-spacing:-0.01em">{esc(club)}</span></td></tr>
<tr><td style="padding:30px 28px 12px"><h1 style="margin:0 0 18px;font-size:24px;line-height:1.2;color:{c_ink};letter-spacing:-0.02em">{esc(title)}</h1>
{''.join(parts_html)}</td></tr>
<tr><td style="padding:14px 28px 26px;font-size:12px;color:#8A93A3;line-height:1.5">{foot}</td></tr>
</table></td></tr></table></body></html>"""
    return html_out, "\n".join(parts_text)


# ---------- queue ----------

def queue(to_email, subject, html_body, text_body, ics=None, kind=""):
    status = "queued" if smtp_config()["ready"] else "held"
    return db.run(
        "INSERT INTO outbox(to_email, subject, html, text, ics, kind, status, created) VALUES (?,?,?,?,?,?,?,?)",
        (to_email, subject, html_body, text_body, ics, kind, status, db.now_iso()))


def send_one(cfg, row):
    msg = EmailMessage()
    club = db.get_setting("club_name") or "Mahina Club"
    msg["Subject"] = row["subject"]
    msg["From"] = formataddr((club, cfg["from"]))
    msg["To"] = row["to_email"]
    msg["Message-ID"] = make_msgid(domain=cfg["from"].split("@")[-1] or None)
    reply = db.get_setting("email")
    if reply:
        msg["Reply-To"] = reply
    msg.set_content(row["text"])
    msg.add_alternative(row["html"], subtype="html")
    if row.get("ics"):
        msg.add_attachment(row["ics"].encode(), maintype="text", subtype="calendar", filename="event.ics")
    ctx = ssl.create_default_context()
    if cfg["security"] == "ssl":
        with smtplib.SMTP_SSL(cfg["host"], cfg["port"], context=ctx, timeout=20) as s:
            if cfg["user"]:
                s.login(cfg["user"], cfg["password"])
            s.send_message(msg)
    else:
        with smtplib.SMTP(cfg["host"], cfg["port"], timeout=20) as s:
            if cfg["security"] == "starttls":
                s.starttls(context=ctx)
            if cfg["user"]:
                s.login(cfg["user"], cfg["password"])
            s.send_message(msg)


def flush(limit=40):
    cfg = smtp_config()
    if not cfg["ready"]:
        return 0
    rows = db.q("SELECT * FROM outbox WHERE status='queued' ORDER BY id LIMIT ?", (limit,))
    sent = 0
    for r in rows:
        try:
            send_one(cfg, r)
            db.run("UPDATE outbox SET status='sent', sent_at=?, error='' WHERE id=?", (db.now_iso(), r["id"]))
            sent += 1
        except Exception as e:  # keep going; show the error in the admin outbox
            db.run("UPDATE outbox SET status='failed', error=? WHERE id=?", (str(e)[:300], r["id"]))
    return sent


# ---------- reminders ----------

def due_reminders():
    """Queue reminder emails for events whose reminder window has opened."""
    now_local = db.now_local()
    horizon = (now_local + timedelta(days=8)).isoformat()
    events = db.q("SELECT * FROM events WHERE status='published' AND starts_at > ? AND starts_at < ?",
                  (now_local.isoformat(), horizon))
    for ev in events:
        start = datetime.fromisoformat(ev["starts_at"])
        for hours in json.loads(ev.get("reminders") or "[]"):
            if now_local < start - timedelta(hours=int(hours)):
                continue
            people = {}
            cutoff = (start - timedelta(hours=int(hours))).isoformat()
            for r in db.q("SELECT name, email, token FROM rsvps WHERE event_id=? AND status='going' AND created < ? "
                          "AND COALESCE(reminders, 1)=1", (ev["id"], cutoff)):
                people.setdefault(r["email"].lower(), {"name": r["name"], "token": r["token"], "items": []})
            for s in db.q("""SELECT sg.name, sg.email, sg.token, sl.title slot, sg.item FROM signups sg
                             JOIN slots sl ON sl.id=sg.slot_id JOIN sheets sh ON sh.id=sl.sheet_id
                             WHERE sh.event_id=? AND sg.created < ? AND COALESCE(sg.reminders, 1)=1""", (ev["id"], cutoff)):
                p = people.setdefault(s["email"].lower(), {"name": s["name"], "token": s["token"], "items": []})
                p["items"].append(s["slot"] + (f" ({s['item']})" if s["item"] else ""))
            for email, p in people.items():
                if db.one("SELECT 1 FROM reminders_sent WHERE event_id=? AND hours=? AND email=?", (ev["id"], hours, email)):
                    continue
                db.run("INSERT OR IGNORE INTO reminders_sent(event_id, hours, email) VALUES (?,?,?)", (ev["id"], hours, email))
                rows = [("When", fmt_when(ev)), ("Where", ev["location"])]
                if p["items"]:
                    rows.append(("You're bringing", ", ".join(p["items"])))
                h, t = render(f"See you soon at {ev['title']}", [("rows", rows)],
                              button=("View event", f"{site_url()}/events/{ev['slug']}"),
                              footer_link=("Change or cancel", f"{site_url()}/me/{p['token']}"))
                queue(email, f"Reminder: {ev['title']}", h, t, ics_for([ev]), "reminder")


def worker():
    def loop():
        tick = 0
        while True:
            try:
                if tick % 3 == 0:
                    due_reminders()
                if tick % 9 == 0:
                    from . import shop
                    shop.check_venmo_mail()
                if tick % 180 == 0:
                    db.prune()
                flush()
            except Exception as e:
                print("mail worker:", e)
            tick += 1
            time.sleep(20)
    threading.Thread(target=loop, daemon=True, name="mail-worker").start()
