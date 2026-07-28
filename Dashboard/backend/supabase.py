"""Push published manifests and dashboard sign-ins up to Supabase.

Two codebases share one database. This one writes; the UCXP runtime reads. The
column names here are fixed by `docs/manifest-sync.md` on `main` -- that file is
the contract, so it changes first and both sides follow. Writing a different
name than the runtime reads produces nothing worse than a business that never
appears, which is indistinguishable from a runtime bug and takes a day to find.

Every call here is **best effort and never raises into a request**. The
dashboard's SQLite is the source of truth and the runtime falls back to the
committed `manifests/*.json`, so an unreachable database means a stale row --
not a merchant who cannot activate, and not a person who cannot sign in.

Not configured is a normal state, not an error: local development and the whole
test suite run with no Supabase at all.
"""

import json
import logging
import os
import threading
import urllib.error
import urllib.parse
import urllib.request

log = logging.getLogger("ucxp.supabase")

MANIFEST_TABLE = "ucxp_manifests"
USER_TABLE = "ucxp_dashboard_users"


def _env(name):
    return (os.environ.get(name) or "").strip().strip("'\"")


def base_url():
    return _env("SUPABASE_URL").rstrip("/")


def service_key():
    """The service-role key, under either name the two codebases use.

    `docs/manifest-sync.md` specifies SUPABASE_SERVICE_KEY; the Supabase console
    labels the value SUPABASE_SERVICE_ROLE_KEY and that is what tends to get
    pasted. Accepting both costs one line and saves an afternoon.
    """
    return _env("SUPABASE_SERVICE_KEY") or _env("SUPABASE_SERVICE_ROLE_KEY")


def timeout():
    try:
        return float(_env("UCXP_SUPABASE_TIMEOUT") or 10)
    except ValueError:
        return 10.0


def enabled():
    return bool(base_url() and service_key())


def _request(method, table, body=None, params=None, prefer=None):
    """One PostgREST call. Returns {"ok": bool, "error": str, "data": ...}."""
    if not enabled():
        return {"ok": False, "skipped": True, "error": "Supabase is not configured."}

    url = "{}/rest/v1/{}".format(base_url(), table)
    if params:
        url += "?" + urllib.parse.urlencode(params)

    key = service_key()
    headers = {
        "apikey": key,
        "Authorization": "Bearer {}".format(key),
        "Content-Type": "application/json",
        "Accept": "application/json",
    }
    if prefer:
        headers["Prefer"] = prefer

    data = None if body is None else json.dumps(body).encode("utf-8")
    request = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(request, timeout=timeout()) as response:
            raw = response.read().decode("utf-8") or "null"
        return {"ok": True, "error": "", "data": json.loads(raw)}
    except urllib.error.HTTPError as exc:
        detail = ""
        try:
            detail = exc.read().decode("utf-8")[:300]
        except Exception:  # noqa: BLE001 -- the error body is a nicety, not a requirement
            pass
        # A missing table is the one failure worth naming precisely: it means
        # db/schema.sql was never run, which no amount of retrying will fix.
        if exc.code in (404, 400) and "does not exist" in detail:
            message = ("The {} table does not exist in Supabase. "
                       "Run db/schema.sql in the SQL editor.".format(table))
        else:
            message = "Supabase returned {}: {}".format(exc.code, detail or exc.reason)
        log.warning("%s %s -- %s", method, table, message)
        return {"ok": False, "error": message}
    except (urllib.error.URLError, OSError, ValueError) as exc:
        message = "Could not reach Supabase: {}".format(exc)
        log.warning("%s %s -- %s", method, table, message)
        return {"ok": False, "error": message}


# --------------------------------------------------------------------------
# Manifests -- written on Activate and on every later edit
# --------------------------------------------------------------------------
def publish_manifest(business_id, manifest, version=1, status="active",
                     name="", category=""):
    """Upsert one business's published manifest.

    `merge-duplicates` is what turns this into an upsert; without it a second
    activation is a primary-key conflict rather than an update.
    """
    return _request(
        "POST", MANIFEST_TABLE,
        params={"on_conflict": "business_id"},
        prefer="resolution=merge-duplicates,return=minimal",
        body={
            "business_id": business_id,
            "manifest": manifest,
            "status": status,
            "version": version,
            "name": name or "",
            "category": category or "",
        })


def unpublish_manifest(business_id):
    """Remove a business the dashboard no longer has.

    Deleted rather than marked draft: the dashboard is the source of truth, and
    a row for a business that no longer exists cannot be corrected from here
    later.
    """
    return _request("DELETE", MANIFEST_TABLE,
                    params={"business_id": "eq.{}".format(business_id)},
                    prefer="return=minimal")


# --------------------------------------------------------------------------
# Dashboard users -- a mirror, never the source of truth
# --------------------------------------------------------------------------
def record_user(user):
    """Upsert one sign-in record. `user` is a row from store.record_sign_in."""
    return _request(
        "POST", USER_TABLE,
        params={"on_conflict": "email"},
        prefer="resolution=merge-duplicates,return=minimal",
        body={
            "email": user.get("email") or "",
            "name": user.get("name") or "",
            "picture": user.get("picture") or "",
            "is_admin": bool(user.get("is_admin")),
            "first_seen": user.get("first_seen"),
            "last_seen": user.get("last_seen"),
            "sign_in_count": user.get("sign_in_count") or 1,
        })


def record_user_in_background(user):
    """Mirror a sign-in without making the person wait for it.

    This runs on the OAuth callback, which is the one moment the user is staring
    at a blank tab. A slow or unreachable Supabase would add its full timeout to
    every single sign-in, so the round trip happens on a daemon thread and its
    outcome only ever reaches the log.
    """
    if not enabled():
        return None
    thread = threading.Thread(target=record_user, args=(user,), daemon=True,
                              name="supabase-record-user")
    thread.start()
    return thread
