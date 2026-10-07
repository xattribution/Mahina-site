"""Confirm-it's-you check before anything that controls where money goes or who can change it.

Covered: the club Venmo handle, the Venmo payment mailbox, the email server (codes travel through it), and creating or
promoting admins or setting another account's password (a new admin could confirm on their own otherwise).

An admin who is already signed in proves it's them with a 6-digit code emailed to their own account address. Only while
the site has no email service at all does their password stand in. A pass lasts 10 minutes for that one browser
session, so a stolen session cookie alone can't redirect the club's money.
"""
import hashlib
import hmac
import secrets
import threading
import time
from collections import defaultdict, deque
from datetime import datetime, timedelta

from . import auth, db, mailer
from .store import Invalid

PASS_MINUTES = 10
CODE_MINUTES = 10
MAX_TRIES = 5
_lock = threading.Lock()
_sends = defaultdict(deque)


def _hash(code):
    return hmac.new(auth.secret_key().encode(), code.encode(), hashlib.sha256).hexdigest()


def passed(user):
    r = db.one("SELECT stepup_until FROM sessions WHERE token=?", (user.get("token"),))
    return bool(r and r["stepup_until"] and r["stepup_until"] > datetime.utcnow().isoformat())


def require(user):
    if not passed(user):
        raise Invalid("Confirm it's you to change this.", field="stepup", status=428)


def start(user):
    """Send a code, or (only before email is set up) ask for the password. Decided here, on the server."""
    with _lock:
        dq = _sends[user["id"]]
        while dq and dq[0] < time.time() - 600:
            dq.popleft()
        if len(dq) >= 3:
            raise Invalid("You've asked for this a few times already. Wait 10 minutes and try again.", status=429)
        dq.append(time.time())
    expires = (datetime.utcnow() + timedelta(minutes=CODE_MINUTES)).isoformat()
    if not mailer.smtp_config()["ready"]:
        a = db.one("SELECT pw_hash FROM admins WHERE id=?", (user["id"],))
        if not (a and a["pw_hash"]):
            raise Invalid("Connect an email service in Settings first, so a code can be sent.")
        db.run("INSERT OR REPLACE INTO step_checks(session, admin_id, method, code_hash, expires, tries) VALUES (?,?,?,?,?,0)",
               (user["token"], user["id"], "password", "", expires))
        return {"method": "password"}
    code = f"{secrets.randbelow(1_000_000):06d}"
    db.run("INSERT OR REPLACE INTO step_checks(session, admin_id, method, code_hash, expires, tries) VALUES (?,?,?,?,?,0)",
           (user["token"], user["id"], "email", _hash(code), expires))
    h, t = mailer.render(f"Your code: {code}", [
        f"Someone signed in as you asked to change a protected setting (payments, email, or admin accounts). "
        f"Enter this code to confirm: {code}",
        f"It works for {CODE_MINUTES} minutes. If this wasn't you, change your password and tell another admin."])
    # Sent straight away and never stored in the outbox, so no one else on the team can read it there.
    try:
        mailer.send_one(mailer.smtp_config(), {"to_email": user["email"], "subject": f"{code} is your confirmation code",
                                               "html": h, "text": t, "ics": None, "reply_to": user["email"]})
    except Exception:
        # Email is broken (or was broken on purpose): fall back to the password so admins can't be locked out of
        # fixing it. A stolen session alone still can't pass, since it doesn't know the password.
        a = db.one("SELECT pw_hash FROM admins WHERE id=?", (user["id"],))
        if not (a and a["pw_hash"]):
            db.run("DELETE FROM step_checks WHERE session=?", (user["token"],))
            raise Invalid("The code email couldn't be sent. Check Settings > Email and try again.")
        db.run("UPDATE step_checks SET method='password', code_hash='' WHERE session=?", (user["token"],))
        return {"method": "password", "reason": "email"}
    from .admin import mask_email
    return {"method": "email", "to": mask_email(user["email"])}


def check(user, body):
    with _lock:
        r = db.one("SELECT * FROM step_checks WHERE session=?", (user["token"],))
        if not r or r["expires"] < datetime.utcnow().isoformat() or r["tries"] >= MAX_TRIES:
            raise Invalid("That expired. Start again.", "code")
        db.run("UPDATE step_checks SET tries=tries+1 WHERE session=?", (user["token"],))
        left = MAX_TRIES - r["tries"] - 1
        tail = f" {left} tries left." if left else " Start again."
    if r["method"] == "email":
        code = str(body.get("code") or "").strip().replace(" ", "")
        if not (code.isdigit() and hmac.compare_digest(_hash(code), r["code_hash"])):
            raise Invalid("That code isn't right." + tail, "code")
    else:
        pw = body.get("password")
        a = db.one("SELECT pw_hash FROM admins WHERE id=?", (user["id"],))
        ok, _ = auth.verify_password(pw if isinstance(pw, str) else "", a["pw_hash"] if a else None)
        if not ok:
            raise Invalid("That password isn't right." + tail, "password")
    db.run("DELETE FROM step_checks WHERE session=?", (user["token"],))
    db.run("UPDATE sessions SET stepup_until=? WHERE token=?",
           ((datetime.utcnow() + timedelta(minutes=PASS_MINUTES)).isoformat(), user["token"]))
    return {"ok": True, "minutes": PASS_MINUTES}


def alert_admins(user, what, detail, cfg=None):
    """Tell every admin when a protected setting changes. cfg sends through the email settings as they were before the
    change, so someone who just repointed the email server can't swallow the warning."""
    h, t = mailer.render(f"Changed: {what}", [
        f"{user['name']} changed {what}.", ("rows", [("Change", detail), ("When", db.now_local().strftime("%b %d, %Y %I:%M %p"))]),
        "If nobody on the team expected this, undo it in Settings and change that account's password."],
        button=("Open Settings", f"{mailer.site_url()}/team/settings"))
    for a in db.q("SELECT email FROM admins WHERE role='admin'"):
        oid = mailer.queue(a["email"], f"Changed: {what}", h, t, kind="security")
        if cfg and cfg.get("ready"):
            try:
                mailer.send_one(cfg, db.one("SELECT * FROM outbox WHERE id=?", (oid,)))
                db.run("UPDATE outbox SET status='sent', sent_at=? WHERE id=?", (db.now_iso(), oid))
            except Exception:
                pass  # stays queued for the normal sender
