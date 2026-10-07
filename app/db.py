"""SQLite storage for the Mahina Club."""
import json
import os
import re
import secrets
import sqlite3
import threading
import time
from contextlib import contextmanager
from datetime import datetime
from zoneinfo import ZoneInfo

DATA_DIR = os.environ.get("MAHINA_DATA", os.path.join(os.path.dirname(os.path.dirname(__file__)), "data"))
DB_PATH = os.path.join(DATA_DIR, "mahina.db")
UPLOAD_DIR = os.path.join(DATA_DIR, "uploads")

_local = threading.local()

SCHEMA = """
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS admins (
  id INTEGER PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
  pw_hash TEXT NOT NULL, created TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY, admin_id INTEGER NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
  expires TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS tags (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, slug TEXT UNIQUE NOT NULL, color TEXT NOT NULL DEFAULT 'reef');

CREATE TABLE IF NOT EXISTS photos (
  id INTEGER PRIMARY KEY, file TEXT NOT NULL, thumb TEXT NOT NULL, w INTEGER, h INTEGER,
  caption TEXT DEFAULT '', event_id INTEGER REFERENCES events(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'approved', submitted_by TEXT DEFAULT '', created TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS photo_tags (
  photo_id INTEGER REFERENCES photos(id) ON DELETE CASCADE,
  tag_id INTEGER REFERENCES tags(id) ON DELETE CASCADE, PRIMARY KEY (photo_id, tag_id));

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY, slug TEXT UNIQUE NOT NULL, title TEXT NOT NULL,
  starts_at TEXT NOT NULL, ends_at TEXT, all_day INTEGER DEFAULT 0,
  location TEXT DEFAULT '', map_url TEXT DEFAULT '', summary TEXT DEFAULT '', description TEXT DEFAULT '',
  cover_photo_id INTEGER REFERENCES photos(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'published', rsvp_enabled INTEGER DEFAULT 1, capacity INTEGER,
  reminders TEXT DEFAULT '[24]', created TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS event_tags (
  event_id INTEGER REFERENCES events(id) ON DELETE CASCADE,
  tag_id INTEGER REFERENCES tags(id) ON DELETE CASCADE, PRIMARY KEY (event_id, tag_id));

CREATE TABLE IF NOT EXISTS rsvps (
  id INTEGER PRIMARY KEY, event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  name TEXT NOT NULL, email TEXT NOT NULL, guests INTEGER DEFAULT 0, status TEXT NOT NULL DEFAULT 'going',
  token TEXT NOT NULL, created TEXT NOT NULL, UNIQUE(event_id, email));

CREATE TABLE IF NOT EXISTS sheets (
  id INTEGER PRIMARY KEY, event_id INTEGER REFERENCES events(id) ON DELETE CASCADE,
  title TEXT NOT NULL, description TEXT DEFAULT '', status TEXT NOT NULL DEFAULT 'open',
  closes_at TEXT, show_names INTEGER DEFAULT 1, sort INTEGER DEFAULT 0, created TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS slots (
  id INTEGER PRIMARY KEY, sheet_id INTEGER NOT NULL REFERENCES sheets(id) ON DELETE CASCADE,
  title TEXT NOT NULL, note TEXT DEFAULT '', capacity INTEGER DEFAULT 1, starts_at TEXT, ends_at TEXT,
  ask_item INTEGER DEFAULT 0, sort INTEGER DEFAULT 0);

CREATE TABLE IF NOT EXISTS signups (
  id INTEGER PRIMARY KEY, slot_id INTEGER NOT NULL REFERENCES slots(id) ON DELETE CASCADE,
  name TEXT NOT NULL, email TEXT NOT NULL, phone TEXT DEFAULT '', qty INTEGER DEFAULT 1,
  item TEXT DEFAULT '', token TEXT NOT NULL, created TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS polls (
  id INTEGER PRIMARY KEY, slug TEXT UNIQUE NOT NULL, title TEXT NOT NULL, intro TEXT DEFAULT '',
  event_id INTEGER REFERENCES events(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'open', closes_at TEXT, results TEXT NOT NULL DEFAULT 'after',
  collect_name INTEGER DEFAULT 1, one_per_email INTEGER DEFAULT 1, created TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS questions (
  id INTEGER PRIMARY KEY, poll_id INTEGER NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
  kind TEXT NOT NULL, prompt TEXT NOT NULL, options TEXT DEFAULT '[]', required INTEGER DEFAULT 1, sort INTEGER DEFAULT 0);

CREATE TABLE IF NOT EXISTS responses (
  id INTEGER PRIMARY KEY, poll_id INTEGER NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
  name TEXT DEFAULT '', email TEXT DEFAULT '', answers TEXT NOT NULL, created TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL, subject TEXT DEFAULT '',
  body TEXT NOT NULL, read INTEGER DEFAULT 0, archived INTEGER DEFAULT 0, created TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS subscribers (
  id INTEGER PRIMARY KEY, name TEXT DEFAULT '', email TEXT UNIQUE NOT NULL, token TEXT NOT NULL,
  active INTEGER DEFAULT 1, source TEXT DEFAULT '', created TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS outbox (
  id INTEGER PRIMARY KEY, to_email TEXT NOT NULL, subject TEXT NOT NULL, html TEXT NOT NULL, text TEXT NOT NULL,
  ics TEXT, kind TEXT DEFAULT '', status TEXT NOT NULL DEFAULT 'queued', error TEXT DEFAULT '',
  created TEXT NOT NULL, sent_at TEXT);

CREATE TABLE IF NOT EXISTS reminders_sent (
  event_id INTEGER, hours INTEGER, email TEXT, PRIMARY KEY (event_id, hours, email));

-- Internal event planning (team only): tasks and volunteer assignments, the shopping list, notes.
CREATE TABLE IF NOT EXISTS plan_items (
  id INTEGER PRIMARY KEY, event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  kind TEXT NOT NULL DEFAULT 'task', title TEXT NOT NULL, details TEXT DEFAULT '',
  assignee_id INTEGER REFERENCES admins(id) ON DELETE SET NULL, assignee_name TEXT DEFAULT '',
  due TEXT, qty TEXT DEFAULT '', est_cost REAL, cost REAL,
  done INTEGER DEFAULT 0, done_by TEXT DEFAULT '', done_at TEXT,
  sort INTEGER DEFAULT 0, created_by TEXT DEFAULT '', created TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS plan_notes (
  id INTEGER PRIMARY KEY, event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  author_id INTEGER REFERENCES admins(id) ON DELETE SET NULL, author TEXT NOT NULL,
  body TEXT NOT NULL, created TEXT NOT NULL);

-- Invites to join the team. Only a hash of each link's token is stored. Links work once and expire.
CREATE TABLE IF NOT EXISTS invites (
  id INTEGER PRIMARY KEY, token TEXT UNIQUE NOT NULL, email TEXT NOT NULL, name TEXT DEFAULT '',
  role TEXT NOT NULL DEFAULT 'member', perms TEXT NOT NULL DEFAULT '[]',
  invited_by INTEGER REFERENCES admins(id) ON DELETE SET NULL, invited_by_name TEXT DEFAULT '',
  created TEXT NOT NULL, expires TEXT NOT NULL, used_at TEXT);

-- Who did what in the admin console.
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY, at TEXT NOT NULL, actor_id INTEGER, actor TEXT NOT NULL,
  action TEXT NOT NULL, target TEXT DEFAULT '', ip TEXT DEFAULT '');

CREATE INDEX IF NOT EXISTS idx_plan_event ON plan_items(event_id, kind);
CREATE INDEX IF NOT EXISTS idx_plan_assignee ON plan_items(assignee_id);
CREATE INDEX IF NOT EXISTS idx_audit_at ON audit_log(at);
CREATE INDEX IF NOT EXISTS idx_events_start ON events(starts_at);
CREATE INDEX IF NOT EXISTS idx_signups_slot ON signups(slot_id);
CREATE INDEX IF NOT EXISTS idx_outbox_status ON outbox(status);
"""

DEFAULT_SETTINGS = {
    "club_name": "Mahina Club",
    "palette": "classic",
    "moon_caption": False,
    "accent": "",
    "org_line": "Space Forces–Indo-Pacific",
    "timezone": "Pacific/Honolulu",
    "email": "",
    "venmo": "",
    "donate_goal": {"label": "", "goal": 0, "raised": 0},
    "donate_uses": [],
    "banner": {"text": "", "link": "", "active": False},
    "spotlight": {"kind": "next", "id": None},
    "home_sections": [{"key": "coming", "on": True}, {"key": "photos", "on": True},
                      {"key": "polls", "on": True}, {"key": "give", "on": True}],
    "labels": {"coming": "Coming up", "photos": "Photos", "polls": "Polls"},
    "officers": [],
    "public_uploads": True,
    "disclaimer": "The Mahina Club is a private organization. It is not a part of the Department of Defense or any of its components and has no governmental status.",
    "smtp": {"host": "", "port": 587, "user": "", "password": "", "from": "", "security": "starttls"},
    "site_url": "",
}


def club_tz():
    try:
        r = conn().execute("SELECT value FROM settings WHERE key='timezone'").fetchone()
        return ZoneInfo(json.loads(r["value"]) if r else "Pacific/Honolulu")
    except Exception:
        return ZoneInfo("Pacific/Honolulu")


def now_local():
    """Wall-clock time in the club's time zone (naive). All stored times use this clock."""
    return datetime.now(club_tz()).replace(tzinfo=None, microsecond=0)


def now_iso():
    return now_local().isoformat()


def conn():
    c = getattr(_local, "conn", None)
    if c is None:
        os.makedirs(DATA_DIR, exist_ok=True)
        c = sqlite3.connect(DB_PATH, timeout=15, check_same_thread=False)
        c.row_factory = sqlite3.Row
        c.execute("PRAGMA foreign_keys = ON")
        c.execute("PRAGMA journal_mode = WAL")
        c.execute("PRAGMA secure_delete = ON")  # deleted personal data is overwritten, not left in free pages
        _local.conn = c
    return c


@contextmanager
def tx():
    c = conn()
    try:
        yield c
        c.commit()
    except Exception:
        c.rollback()
        raise


# Columns added after the first release. Each is added only if missing, so upgrades keep every row as it was.
# Accounts that existed before roles keep full admin access (the column default).
ADDED_COLUMNS = [
    ("admins", "role", "TEXT NOT NULL DEFAULT 'admin'"),
    ("admins", "perms", "TEXT NOT NULL DEFAULT '[]'"),
    ("admins", "last_login", "TEXT"),
    ("slots", "photo_id", "INTEGER REFERENCES photos(id) ON DELETE SET NULL"),
    ("slots", "ask_servings", "INTEGER DEFAULT 0"),
    ("slots", "is_other", "INTEGER DEFAULT 0"),
    ("signups", "servings", "INTEGER"),
    ("sheets", "allow_other", "INTEGER DEFAULT 0"),
    ("slots", "choices", "TEXT DEFAULT '[]'"),
    ("signups", "choice_id", "TEXT"),
]


def _private_files():
    """Keep the database and uploads readable only by the app's own user."""
    for path, mode in [(DATA_DIR, 0o700), (UPLOAD_DIR, 0o700)]:
        try:
            os.chmod(path, mode)
        except OSError:
            pass
    for name in os.listdir(DATA_DIR):
        path = os.path.join(DATA_DIR, name)
        # Upgrade safety copies hold personal data, so they don't outlive a month.
        if name.startswith("mahina-before-upgrade-") and os.path.getmtime(path) < time.time() - 30 * 86400:
            try:
                os.remove(path)
            except OSError:
                pass
            continue
        if name.startswith("mahina.db") or name.endswith(".db"):
            try:
                os.chmod(os.path.join(DATA_DIR, name), 0o600)
            except OSError:
                pass


def migrate(c):
    missing = []
    for table, col, decl in ADDED_COLUMNS:
        if col not in {r[1] for r in c.execute(f"PRAGMA table_info({table})")}:
            missing.append((table, col, decl))
    if not missing:
        return
    # One-time safety copy before changing the shape of an existing database.
    if c.execute("SELECT 1 FROM admins LIMIT 1").fetchone():
        snap = os.path.join(DATA_DIR, f"mahina-before-upgrade-{datetime.now().strftime('%Y%m%d-%H%M%S')}.db")
        dest = sqlite3.connect(snap)
        c.backup(dest)
        dest.close()
        os.chmod(snap, 0o600)
    for table, col, decl in missing:
        c.execute(f"ALTER TABLE {table} ADD COLUMN {col} {decl}")


def init():
    os.umask(0o077)
    os.makedirs(UPLOAD_DIR, exist_ok=True)
    c = conn()
    c.executescript(SCHEMA)
    migrate(c)
    for k, v in DEFAULT_SETTINGS.items():
        c.execute("INSERT OR IGNORE INTO settings(key, value) VALUES (?, ?)", (k, json.dumps(v)))
    c.commit()
    _private_files()


def prune():
    """Housekeeping: sent email copies go after 90 days, the activity log after 400."""
    c = conn()
    now = now_local()
    from datetime import timedelta
    c.execute("DELETE FROM outbox WHERE status='sent' AND created < ?", ((now - timedelta(days=90)).isoformat(),))
    c.execute("DELETE FROM audit_log WHERE at < ?", ((now - timedelta(days=400)).isoformat(),))
    c.execute("DELETE FROM invites WHERE expires < ?", ((now - timedelta(days=30)).isoformat(),))
    c.commit()


def q(sql, args=()):
    return [dict(r) for r in conn().execute(sql, args).fetchall()]


def one(sql, args=()):
    r = conn().execute(sql, args).fetchone()
    return dict(r) if r else None


def run(sql, args=()):
    c = conn()
    cur = c.execute(sql, args)
    c.commit()
    return cur.lastrowid


# Colors used where CSS can't reach (emails). Keep in step with the palettes in web/css/site.css.
PALETTES = {
    "classic": {"name": "Red, white & blue", "night": "#0F2340", "accent": "#C8233B", "moon": "#F4ECD6", "ink": "#0F2340",
                "text": "#253248", "muted": "#5B6678", "mist": "#EEF1F4"},
    "ocean": {"name": "Ocean", "night": "#0B4552", "accent": "#C2185B", "moon": "#FFF1D6", "ink": "#0A3A44",
              "text": "#24434A", "muted": "#4F6B70", "mist": "#E4F1EE"},
}


def palette_colors():
    s = all_settings()
    pal = dict(PALETTES.get(s.get("palette"), PALETTES["classic"]))
    if s.get("accent"):
        pal["accent"] = s["accent"]
    return pal


def get_setting(key):
    r = one("SELECT value FROM settings WHERE key=?", (key,))
    return json.loads(r["value"]) if r else DEFAULT_SETTINGS.get(key)


def set_setting(key, value):
    run("INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        (key, json.dumps(value)))


def all_settings():
    out = dict(DEFAULT_SETTINGS)
    for r in q("SELECT key, value FROM settings"):
        out[r["key"]] = json.loads(r["value"])
    return out


def token(n=18):
    return secrets.token_urlsafe(n)


def slugify(text, table, current_id=None):
    base = re.sub(r"[^a-z0-9]+", "-", text.lower().replace("ʻ", "").replace("'", "")).strip("-")[:60] or "item"
    slug, i = base, 2
    while True:
        r = one(f"SELECT id FROM {table} WHERE slug=?", (slug,))
        if not r or r["id"] == current_id:
            return slug
        slug = f"{base}-{i}"
        i += 1
