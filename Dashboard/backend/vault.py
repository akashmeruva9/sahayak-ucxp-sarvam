"""Server-side credential store, keyed by business_id.

The security story in one sentence: a raw token enters here and never leaves.
Callers get back a `credential_ref` of the form vault://<business_id>, and that
reference -- not the secret -- is what goes into the manifest, the API responses,
and anything a merchant can download.

`get()` exists for the backend's own outbound Shopify calls only. No route
returns its value.
"""

import json
import os

from . import store

# <repo>/Dashboard/backend/vault.py -> three levels up is the repo root.
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
STORES_JSON = os.path.join(ROOT, "stores.json")

# The five pre-seeded demo stores: subdomain -> canonical business_id slug.
# Mirrors ucxp_handoff/dump_shopify.py's NAMES map.
SEEDED_STORES = {
    "meena-kitchen-store": ("meena-kitchen", "Meena Kitchen Store"),
    "lakshmi-fashion-4kmotaah": ("lakshmi-fashion", "Lakshmi Fashion"),
    "ravi-electronics-bmxitv46": ("ravi-electronics", "Ravi Electronics"),
    "sri-pharma": ("sri-pharma", "Sri Pharma"),
    "anna-groceries": ("anna-groceries", "Anna Groceries"),
}


def ref_for(business_id):
    return "vault://{}".format(business_id)


def put(business_id, secret, kind="shopify_admin_token"):
    """Store a secret and return only its reference."""
    conn = store.connect()
    conn.execute(
        "INSERT INTO vault (business_id, secret, kind, updated_at) VALUES (?, ?, ?, ?) "
        "ON CONFLICT(business_id) DO UPDATE SET secret = excluded.secret, "
        "kind = excluded.kind, updated_at = excluded.updated_at",
        (business_id, secret, kind, store._now()))
    conn.commit()
    return ref_for(business_id)


def get(business_id):
    """Backend-internal only. Never serialize this into a response."""
    conn = store.connect()
    row = conn.execute("SELECT secret FROM vault WHERE business_id = ?",
                       (business_id,)).fetchone()
    return row["secret"] if row else None


def has(business_id):
    conn = store.connect()
    return conn.execute("SELECT 1 FROM vault WHERE business_id = ?",
                        (business_id,)).fetchone() is not None


def delete(business_id):
    conn = store.connect()
    conn.execute("DELETE FROM vault WHERE business_id = ?", (business_id,))
    conn.commit()


def load_seeded_tokens():
    """Read stores.json once at boot so the five demo stores can connect instantly.

    Returns {subdomain: token}. Missing or unreadable file is not an error --
    the dashboard simply has no pre-seeded stores.
    """
    # A hosted deployment has no checked-in secrets file, so the same JSON can
    # arrive as an environment variable instead. The file wins when both exist,
    # which keeps local development behaving exactly as it always has.
    raw = None
    try:
        with open(os.environ.get("UCXP_STORES_JSON") or STORES_JSON,
                  "r", encoding="utf-8") as handle:
            raw = handle.read()
    except OSError:
        raw = os.environ.get("UCXP_STORES_JSON_CONTENT") or ""
    try:
        data = json.loads(raw) if raw else {}
    except ValueError:
        return {}
    return {k: v for k, v in data.items() if isinstance(v, str)} if isinstance(data, dict) else {}


def token_for_subdomain(subdomain):
    """Look up a seeded token so the demo Connect flow needs no pasted secret."""
    return load_seeded_tokens().get((subdomain or "").strip().lower())


def seeded_store_choices():
    """For the Connect modal: the demo stores a merchant can pick without a token."""
    tokens = load_seeded_tokens()
    return [
        {"subdomain": sub, "business_id": SEEDED_STORES[sub][0],
         "name": SEEDED_STORES[sub][1]}
        for sub in tokens
        if sub in SEEDED_STORES
    ]
