"""Admin authentication.

Passwords follow NIST SP 800-63B-4:
- at least 15 characters when the password is the only factor, up to 128, any characters
  (spaces and Unicode included), normalized with NFKC, never truncated
- no composition rules, no forced rotation, no hints or security questions
- new passwords are checked against a blocklist: common and breached passwords,
  repeated patterns, and words tied to this site; plus the Have I Been Pwned range API
  (k-anonymity: only the first 5 characters of a SHA-1 hash leave the server)
- stored with Argon2id; older PBKDF2 hashes are upgraded at next sign-in
- failed sign-ins are throttled per account and per address

Single sign-on (optional): set OIDC_ISSUER, OIDC_CLIENT_ID and OIDC_CLIENT_SECRET to let admins
sign in through any OpenID Connect provider (Pocket ID, Authentik, Authelia, Keycloak, Google
Workspace, Microsoft Entra). Only emails already listed as admins get in.
Set PASSWORD_LOGIN=0 to turn passwords off once single sign-on works.
"""
import gzip
import hashlib
import hmac
import os
import re
import secrets
import time
import unicodedata
from collections import defaultdict, deque
from datetime import datetime, timedelta

import httpx
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError

from . import db
from .store import Invalid

MIN_LEN, MAX_LEN = 15, 128
SESSION_DAYS = 14
_ph = PasswordHasher()  # Argon2id, library defaults (RFC 9106 low-memory profile)
_DUMMY = _ph.hash("timing-equalizer-not-a-real-password")


# ---------- password policy ----------

def normalize(pw: str) -> str:
    return unicodedata.normalize("NFKC", pw or "")


_common = None


def _blocklist():
    global _common
    if _common is None:
        path = os.path.join(os.path.dirname(__file__), "data", "common-passwords.txt.gz")
        try:
            with gzip.open(path, "rt", encoding="utf-8", errors="ignore") as f:
                _common = {line.strip() for line in f if line.strip()}
        except OSError:
            _common = set()
    return _common


def _breached(pw: str) -> bool:
    if os.environ.get("PASSWORD_BREACH_CHECK", "1") == "0":
        return False
    digest = hashlib.sha1(pw.encode("utf-8")).hexdigest().upper()
    try:
        r = httpx.get(f"https://api.pwnedpasswords.com/range/{digest[:5]}", timeout=4,
                      headers={"Add-Padding": "true", "User-Agent": "mahina-club"})
        r.raise_for_status()
    except httpx.HTTPError:
        return False  # don't block sign-up when the service is unreachable; the local list still applies
    for line in r.text.splitlines():
        suffix, _, count = line.partition(":")
        if suffix.strip() == digest[5:] and count.strip() != "0":
            return True
    return False


def check_new_password(pw: str, *, email: str = "", name: str = "", field: str = "password"):
    """Raise Invalid if the password breaks policy. Returns the normalized password."""
    pw = normalize(pw)
    n = len(pw)
    if n < MIN_LEN:
        raise Invalid(f"Use at least {MIN_LEN} characters. A few words strung together works well.", field)
    if n > MAX_LEN:
        raise Invalid(f"Use {MAX_LEN} characters or fewer.", field)
    low = pw.lower()
    squashed = re.sub(r"[\W_]+", "", low)
    common = _blocklist()
    if low in common or squashed in common:
        raise Invalid("That's a commonly used password. Pick something less predictable.", field)
    if len(set(low)) <= 3:
        raise Invalid("That password repeats too few characters. Pick something less predictable.", field)
    for size in range(1, n // 2 + 1):
        if n % size == 0 and low[:size] * (n // size) == low:
            unit = low[:size]
            if size <= 5 or unit in common:
                raise Invalid("That password is a short pattern repeated. Pick something less predictable.", field)
            break
    if re.fullmatch(r"(0123456789|1234567890|abcdefghijklmnopqrstuvwxyz|qwertyuiopasdfghjklzxcvbnm)+", squashed) or \
            squashed in "0123456789" * 20 or squashed in "abcdefghijklmnopqrstuvwxyz" * 6:
        raise Invalid("That password is a keyboard or number sequence. Pick something less predictable.", field)
    club = (db.get_setting("club_name") or "").lower()
    context = {w for w in re.split(r"[\W_]+", " ".join([club, "mahina club space force spaceforce guardian",
                                                         email.split("@")[0], name]).lower()) if len(w) >= 3}
    leftover = squashed
    for w in sorted(context, key=len, reverse=True):
        leftover = leftover.replace(w, "")
    if len(re.sub(r"\d", "", leftover)) < 4:
        raise Invalid("That password is mostly your name, email, or the club's name. Pick something else.", field)
    if _breached(pw):
        raise Invalid("That password has appeared in a data breach. Pick a different one.", field)
    return pw


def hash_password(pw: str) -> str:
    return _ph.hash(normalize(pw))


def verify_password(pw: str, stored: str | None):
    """Returns (ok, new_hash_or_None). Runs a dummy check for unknown accounts to keep timing even."""
    pw = normalize(pw)
    if not stored:
        try:
            _ph.verify(_DUMMY, pw)
        except VerificationError:
            pass
        return False, None
    if stored.startswith("pbkdf2$"):  # hashes from before Argon2id
        try:
            _, salt, _h = stored.split("$")
        except ValueError:
            return False, None
        dk = hashlib.pbkdf2_hmac("sha256", pw.encode(), salt.encode(), 240_000)
        ok = hmac.compare_digest(f"pbkdf2${salt}${dk.hex()}", stored)
        return ok, (_ph.hash(pw) if ok else None)
    try:
        _ph.verify(stored, pw)
    except (VerifyMismatchError, VerificationError, InvalidHashError):
        return False, None
    return True, (_ph.hash(pw) if _ph.check_needs_rehash(stored) else None)


def password_login_enabled():
    return os.environ.get("PASSWORD_LOGIN", "1") != "0" or not oidc_config()


# ---------- throttling ----------

_fail_acct = defaultdict(deque)
_fail_ip = defaultdict(deque)


def _prune(dq, window):
    now = time.time()
    while dq and dq[0] < now - window:
        dq.popleft()
    return dq


def check_throttle(email: str, ip: str):
    if len(_prune(_fail_acct[email], 900)) >= 8 or len(_prune(_fail_ip[ip], 900)) >= 30:
        raise Invalid("Too many sign-in attempts. Wait 15 minutes and try again.", status=429)


def record_failure(email: str, ip: str):
    _fail_acct[email].append(time.time())
    _fail_ip[ip].append(time.time())


def clear_failures(email: str):
    _fail_acct.pop(email, None)


# ---------- sessions ----------

def _digest(tok: str) -> str:
    return hashlib.sha256(tok.encode()).hexdigest()


def create_session(admin_id: int) -> str:
    """Only a hash of the token is stored, so a copied database can't be used to sign in."""
    tok = secrets.token_urlsafe(32)
    now = datetime.utcnow()
    db.run("DELETE FROM sessions WHERE expires < ?", (now.isoformat(),))
    db.run("INSERT INTO sessions(token, admin_id, expires) VALUES (?,?,?)",
           (_digest(tok), admin_id, (now + timedelta(days=SESSION_DAYS)).isoformat()))
    return tok


def session_admin(tok: str | None):
    if not tok:
        return None
    s = db.one("SELECT a.id, a.email, a.name, s.expires, s.token FROM sessions s JOIN admins a ON a.id=s.admin_id "
               "WHERE s.token=?", (_digest(tok),))
    if s and s["expires"] > datetime.utcnow().isoformat():
        return s
    return None


def end_session(tok: str | None):
    if tok:
        db.run("DELETE FROM sessions WHERE token=?", (_digest(tok),))


def end_other_sessions(admin_id: int, keep_tok: str | None):
    db.run("DELETE FROM sessions WHERE admin_id=? AND token != ?", (admin_id, _digest(keep_tok or "")))


# ---------- single sign-on (OpenID Connect) ----------

def oidc_config():
    issuer = os.environ.get("OIDC_ISSUER", "").rstrip("/")
    cid, secret = os.environ.get("OIDC_CLIENT_ID"), os.environ.get("OIDC_CLIENT_SECRET")
    if not (issuer and cid and secret):
        return None
    return {"issuer": issuer, "client_id": cid, "client_secret": secret,
            "name": os.environ.get("OIDC_NAME", "single sign-on"),
            "metadata": os.environ.get("OIDC_DISCOVERY_URL") or f"{issuer}/.well-known/openid-configuration"}


def secret_key():
    key = os.environ.get("SECRET_KEY") or db.get_setting("secret_key")
    if not key:
        key = secrets.token_urlsafe(48)
        db.set_setting("secret_key", key)
    return key
