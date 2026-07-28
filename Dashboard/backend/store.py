"""SQLite persistence for businesses, their per-section drafts, and the vault.

Three tables:
  businesses  one row per merchant (id = slug)
  sections    one row per (business_id, section) -- the autosave unit
  vault       one row per (business_id) holding the raw credential, server-side only

The vault table is the only place a raw token exists. It is never joined into any
API response; backend/vault.py is the sole reader.
"""

import json
import os
import sqlite3
import threading
from datetime import datetime, timezone

from . import manifest as manifest_mod

# <repo>/Dashboard/backend/store.py -> three levels up is the repo root.
DEFAULT_DB = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
    "ucxp.db")
_local = threading.local()
_db_path = os.environ.get("UCXP_DB", DEFAULT_DB)


def _now():
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def set_db_path(path):
    """Point the store at a different file. Used by tests for a temp DB."""
    global _db_path
    _db_path = path
    if hasattr(_local, "conn"):
        try:
            _local.conn.close()
        except sqlite3.Error:
            pass
        del _local.conn


def connect():
    """One connection per thread; FastAPI's threadpool reuses threads.

    The schema is created on first use rather than only at app startup, so tests
    and scripts that import the store directly get a working DB too.
    """
    if getattr(_local, "conn", None) is None or getattr(_local, "path", None) != _db_path:
        # A hosted deployment points UCXP_DB at a mounted volume, and sqlite3
        # will not create missing parent directories -- it just raises "unable to
        # open database file", which reads like a permissions problem rather
        # than a missing folder.
        parent = os.path.dirname(os.path.abspath(_db_path))
        if parent:
            os.makedirs(parent, exist_ok=True)
        conn = sqlite3.connect(_db_path, timeout=15)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA foreign_keys=ON")
        _local.conn = conn
        _local.path = _db_path
        _create_schema(conn)
    return _local.conn


def _create_schema(conn):
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS businesses (
            id          TEXT PRIMARY KEY,
            name        TEXT NOT NULL DEFAULT '',
            status      TEXT NOT NULL DEFAULT 'draft',
            owner_email TEXT NOT NULL DEFAULT '',
            created_at  TEXT NOT NULL,
            updated_at  TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS sections (
            business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
            section     TEXT NOT NULL,
            data        TEXT NOT NULL,
            updated_at  TEXT NOT NULL,
            PRIMARY KEY (business_id, section)
        );
        CREATE TABLE IF NOT EXISTS vault (
            business_id TEXT PRIMARY KEY REFERENCES businesses(id) ON DELETE CASCADE,
            secret      TEXT NOT NULL,
            kind        TEXT NOT NULL DEFAULT 'shopify_admin_token',
            updated_at  TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_sections_business ON sections(business_id);
        CREATE INDEX IF NOT EXISTS idx_businesses_status ON businesses(status);
        CREATE INDEX IF NOT EXISTS idx_businesses_created ON businesses(created_at);
    """)
    _migrate(conn)
    conn.commit()


def _migrate(conn):
    """Bring an older database up to the current schema.

    CREATE TABLE IF NOT EXISTS does nothing to a table that already exists, so
    a deployment that has been running since before ownership existed would
    otherwise keep a businesses table with no owner_email and fail every query
    below. Rows that predate sign-in are left unowned, which reads as
    admin-only -- see list_businesses.
    """
    columns = {row["name"] for row in conn.execute("PRAGMA table_info(businesses)")}
    if "owner_email" not in columns:
        conn.execute(
            "ALTER TABLE businesses ADD COLUMN owner_email TEXT NOT NULL DEFAULT ''")
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_businesses_owner ON businesses(owner_email)")


def init_db():
    """Explicit initialiser kept for app startup and scripts."""
    connect()


# --------------------------------------------------------------------------
# Businesses
# --------------------------------------------------------------------------
def unique_slug(base):
    """Return `base`, or base-2, base-3... if taken."""
    conn = connect()
    slug = base or "your-business"
    n = 1
    while conn.execute("SELECT 1 FROM businesses WHERE id = ?", (slug,)).fetchone():
        n += 1
        slug = "{}-{}".format(base, n)
    return slug


def create_business(name="", business_id=None, sections=None, status="draft",
                    created_at=None, owner_email=""):
    conn = connect()
    slug = business_id or unique_slug(manifest_mod.slugify(name))
    stamp = created_at or _now()
    conn.execute(
        "INSERT INTO businesses (id, name, status, owner_email, created_at, updated_at) "
        "VALUES (?, ?, ?, ?, ?, ?)",
        (slug, name or "", status, (owner_email or "").strip().lower(), stamp, stamp))
    data = sections or manifest_mod.default_sections()
    if name and not (data.get("1") or {}).get("name"):
        data.setdefault("1", {})["name"] = name
    for key, value in data.items():
        conn.execute(
            "INSERT OR REPLACE INTO sections (business_id, section, data, updated_at) "
            "VALUES (?, ?, ?, ?)",
            (slug, str(key), json.dumps(value), stamp))
    conn.commit()
    return slug


def get_business(business_id):
    conn = connect()
    row = conn.execute("SELECT * FROM businesses WHERE id = ?", (business_id,)).fetchone()
    if not row:
        return None
    sections = manifest_mod.default_sections()
    for srow in conn.execute(
            "SELECT section, data FROM sections WHERE business_id = ?", (business_id,)):
        try:
            stored = json.loads(srow["data"])
        except (ValueError, TypeError):
            stored = {}
        if isinstance(stored, dict):
            sections.setdefault(srow["section"], {})
            sections[srow["section"]].update(stored)
        else:
            sections[srow["section"]] = stored
    return {
        "id": row["id"],
        "name": row["name"],
        "status": row["status"],
        "owner_email": row["owner_email"] if "owner_email" in row.keys() else "",
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
        "sections": sections,
    }


def save_section(business_id, section, data):
    conn = connect()
    if not conn.execute("SELECT 1 FROM businesses WHERE id = ?", (business_id,)).fetchone():
        return None
    stamp = _now()
    conn.execute(
        "INSERT INTO sections (business_id, section, data, updated_at) VALUES (?, ?, ?, ?) "
        "ON CONFLICT(business_id, section) DO UPDATE SET data = excluded.data, "
        "updated_at = excluded.updated_at",
        (business_id, str(section), json.dumps(data), stamp))
    # Keep the denormalised name in step so listings stay cheap.
    if str(section) == "1" and isinstance(data, dict):
        conn.execute("UPDATE businesses SET name = ?, updated_at = ? WHERE id = ?",
                     (data.get("name") or "", stamp, business_id))
    else:
        conn.execute("UPDATE businesses SET updated_at = ? WHERE id = ?",
                     (stamp, business_id))
    conn.commit()
    return get_business(business_id)


PLACEHOLDER_SLUG = "your-business"


def is_placeholder_id(business_id):
    """True for the id given to a business created before it had a name."""
    return business_id == PLACEHOLDER_SLUG or business_id.startswith(PLACEHOLDER_SLUG + "-")


def rename_business(old_id, new_id):
    """Re-key a business and everything hanging off it.

    The business_id is the only identifier in UCXP -- it names the manifest file,
    the hosted URL and the vault entry -- so a draft created before the merchant
    typed a name must pick up the real slug once they have. Returns the id in
    effect afterwards, which is `old_id` if the rename could not be applied.
    """
    if not new_id or new_id == old_id:
        return old_id
    conn = connect()
    if conn.execute("SELECT 1 FROM businesses WHERE id = ?", (new_id,)).fetchone():
        return old_id
    try:
        with conn:
            # The FK is ON DELETE CASCADE, not ON UPDATE CASCADE, so re-keying the
            # parent orphans the children until the child updates land. Defer the
            # check to commit, by which point everything is consistent again.
            conn.execute("PRAGMA defer_foreign_keys=ON")
            conn.execute("UPDATE businesses SET id = ?, updated_at = ? WHERE id = ?",
                         (new_id, _now(), old_id))
            conn.execute("UPDATE sections SET business_id = ? WHERE business_id = ?",
                         (new_id, old_id))
            conn.execute("UPDATE vault SET business_id = ? WHERE business_id = ?",
                         (new_id, old_id))
    except sqlite3.Error:
        return old_id
    return new_id


def set_status(business_id, status):
    conn = connect()
    conn.execute("UPDATE businesses SET status = ?, updated_at = ? WHERE id = ?",
                 (status, _now(), business_id))
    conn.commit()


def delete_business(business_id):
    conn = connect()
    cur = conn.execute("DELETE FROM businesses WHERE id = ?", (business_id,))
    conn.execute("DELETE FROM sections WHERE business_id = ?", (business_id,))
    conn.execute("DELETE FROM vault WHERE business_id = ?", (business_id,))
    conn.commit()
    return cur.rowcount > 0


def owner_of(business_id):
    """The owning email, '' if unowned, or None if there is no such business."""
    row = connect().execute(
        "SELECT owner_email FROM businesses WHERE id = ?", (business_id,)).fetchone()
    return None if row is None else (row["owner_email"] or "")


def set_owner(business_id, owner_email):
    conn = connect()
    conn.execute("UPDATE businesses SET owner_email = ? WHERE id = ?",
                 ((owner_email or "").strip().lower(), business_id))
    conn.commit()


def list_businesses(owner_email=None):
    """Every business with derived completion/status, newest first.

    `owner_email=None` means no filtering, which is what an admin and an
    unauthenticated deployment both get. Passing an address narrows it to that
    merchant's own businesses; businesses with no owner -- those created before
    sign-in existed -- belong to nobody and so appear only in the unfiltered
    listing.
    """
    conn = connect()
    if owner_email is None:
        rows = conn.execute(
            "SELECT id FROM businesses ORDER BY created_at DESC, id ASC")
    else:
        rows = conn.execute(
            "SELECT id FROM businesses WHERE owner_email = ? "
            "ORDER BY created_at DESC, id ASC",
            ((owner_email or "").strip().lower(),))
    ids = [r["id"] for r in rows]
    out = []
    for bid in ids:
        biz = get_business(bid)
        if biz:
            out.append(summarize(biz))
    return out


def summarize(biz):
    """The shape both GET /api/businesses and GET /api/admin/merchants return."""
    sections = biz["sections"]
    profile = sections.get("1") or {}
    ds = sections.get("2") or {}
    langs = (sections.get("4") or {}).get("selected") or []
    caps = [k for k, v in ((sections.get("3") or {}).get("caps") or {}).items()
            if v and v.get("enabled")]
    return {
        "id": biz["id"],
        "name": profile.get("name") or biz["name"] or "",
        "tagline": profile.get("tagline") or "",
        "category": profile.get("category") or "",
        "email": profile.get("email") or "",
        "city": profile.get("city") or "",
        "logo_url": profile.get("logoUrl") or "",
        "languages": langs,
        "capabilities": caps,
        "data_source": ds.get("type") or "",
        "completion": manifest_mod.completion_pct(sections),
        "done_count": manifest_mod.done_count(sections),
        "status": "Active" if biz["status"] == "active" else "Draft",
        "owner_email": biz.get("owner_email") or "",
        "created_at": biz["created_at"],
        "updated_at": biz["updated_at"],
    }
