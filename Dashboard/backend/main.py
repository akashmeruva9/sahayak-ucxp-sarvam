"""FastAPI app for the UCXP merchant dashboard.

Error contract: every failure -- validation, upstream, or unexpected -- comes back
as {"error": "<friendly sentence>"}. A stack trace is never sent to a client, and
a bad Shopify token is a 200 with {"ok": false, "error": ...}, not a 500, because
the merchant needs to see the message inline rather than hit an error screen.
"""

import asyncio
import json
import logging
import os
import urllib.error
import urllib.parse
import urllib.request
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, RedirectResponse
from pydantic import BaseModel

# Before anything else in the package: several modules read their configuration
# at import time, and locally that configuration lives in .env rather than in
# the environment run.sh hands to uvicorn.
from . import envfile

envfile.load()

from . import (auth, constants, manifest as manifest_mod, scraper,  # noqa: E402
               shopify_client, store, vault)

log = logging.getLogger("ucxp")

# backend lives at <repo>/Dashboard/backend, so the repo root is three levels up.
# Locally, manifests/, stores.json and ucxp.db all sit at the repo root. On a
# host with an ephemeral filesystem every one of those has to move onto a
# mounted volume, so each is overridable by environment.
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
MANIFEST_DIR = os.environ.get("UCXP_MANIFEST_DIR") or os.path.join(ROOT, "manifests")

# Where a published manifest can be fetched. Defaults to the aspirational domain
# the design used; set UCXP_PUBLIC_BASE_URL to whatever actually serves this app.
PUBLIC_BASE_URL = (os.environ.get("UCXP_PUBLIC_BASE_URL") or "https://api.ucxp.in").strip().rstrip("/")

# Same-origin deployments never consult this -- the frontend is served by this
# app and calls a relative /api. It matters only when the two are split apart.
ALLOWED_ORIGINS = [
    origin.strip()
    for origin in (os.environ.get("UCXP_ALLOWED_ORIGINS") or
                   "http://localhost:5173,http://127.0.0.1:5173,"
                   "http://localhost:4173,http://127.0.0.1:4173").split(",")
    if origin.strip()
]

# The built frontend, when this app is also serving it (single-service hosting).
FRONTEND_DIST = os.environ.get("UCXP_FRONTEND_DIST") or os.path.join(
    ROOT, "Dashboard", "frontend", "dist")

def _display_path(path):
    """A path a human can read, whether or not it sits inside the repo."""
    relative = os.path.relpath(path, ROOT)
    return os.path.basename(path) if relative.startswith("..") else relative


def _write_manifest_files(business_id, built):
    """Write both published artifacts. Returns their paths."""
    os.makedirs(MANIFEST_DIR, exist_ok=True)
    flat_path = os.path.join(MANIFEST_DIR, "{}.json".format(business_id))
    protocol_path = os.path.join(MANIFEST_DIR, "{}.protocol.json".format(business_id))
    with open(flat_path, "w", encoding="utf-8") as handle:
        json.dump(built, handle, indent=2, ensure_ascii=False)
    with open(protocol_path, "w", encoding="utf-8") as handle:
        json.dump(manifest_mod.to_protocol(built), handle, indent=2, ensure_ascii=False)
    return flat_path, protocol_path


def _republish(biz):
    """Refresh a live business's published files after an edit.

    The success screen promises "changes republish automatically", and until
    now only activation wrote anything -- so an edit updated the database and
    the live preview while the file a runtime actually reads stayed stale. A
    business still in draft has nothing published yet, so it is left alone, and
    an edit that breaks validation keeps the last good file rather than
    replacing it with something invalid.
    """
    if biz.get("status") != "active":
        return
    built = manifest_mod.assemble(biz["id"], biz["sections"],
                                  created_at=biz["created_at"])
    ok, _errors = manifest_mod.validate(built)
    if not ok:
        log.info("republish skipped for %s -- manifest no longer valid", biz["id"])
        return
    try:
        _write_manifest_files(biz["id"], built)
    except OSError:
        log.warning("could not republish manifest for %s", biz["id"])


@asynccontextmanager
async def lifespan(_app):
    store.init_db()
    # Raises when UCXP_REQUIRE_AUTH is set and sign-in cannot actually run, so a
    # misconfigured host fails visibly at boot instead of serving an open
    # dashboard that looks perfectly healthy.
    for warning in auth.check_startup_config():
        log.warning("%s", warning)
    yield


app = FastAPI(title="UCXP Dashboard API", version="1.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# --------------------------------------------------------------------------
# Error handling -- nothing leaks a trace
# --------------------------------------------------------------------------
class FriendlyError(Exception):
    def __init__(self, message, status=400):
        super().__init__(message)
        self.message = message
        self.status = status


@app.exception_handler(FriendlyError)
def _friendly_handler(request: Request, exc: FriendlyError):
    return JSONResponse(status_code=exc.status, content={"error": exc.message})


@app.exception_handler(Exception)
def _catch_all(request: Request, exc: Exception):
    log.exception("Unhandled error on %s", request.url.path)
    return JSONResponse(
        status_code=500,
        content={"error": "Something went wrong on our side. Please try again."},
    )


# --------------------------------------------------------------------------
# Who is asking
#
# Sign-in is enforced here rather than endpoint by endpoint, so a route added
# later is protected by default -- the failure mode of the opposite arrangement
# is a new endpoint that quietly serves every merchant's data to the internet.
# --------------------------------------------------------------------------
# Reachable signed out: the health probe, and the sign-in dance itself. Anything
# under /api not listed here needs a session once auth is configured.
PUBLIC_API_PATHS = {
    "/api/health",
    "/api/auth/login",
    "/api/auth/callback",
    "/api/auth/logout",
    "/api/auth/me",
}


@app.middleware("http")
async def require_session(request: Request, call_next):
    request.state.user = auth.read_session(request)
    path = request.url.path.rstrip("/") or "/"
    if (auth.enabled() and path.startswith("/api")
            and path not in PUBLIC_API_PATHS and request.state.user is None):
        return JSONResponse(status_code=401,
                            content={"error": "Please sign in to continue."})
    return await call_next(request)


def _user(request):
    return getattr(request.state, "user", None)


def _require_admin(request):
    """Admin console access. A no-op while sign-in is unconfigured."""
    user = _user(request)
    if user is None:
        return
    if not user["is_admin"]:
        raise FriendlyError(
            "The admin console is limited to Sahayak administrators.", status=403)


def _require_owner(request, business_id):
    """Check this account may touch this business.

    Admins may touch anything. A merchant may touch only what they own, which
    means a business created before sign-in existed -- owner '' -- is reachable
    by an admin alone until someone adopts it. A business that does not exist is
    left to the endpoint, so a genuine 404 still reads as one.
    """
    user = _user(request)
    if user is None or user["is_admin"]:
        return
    owner = store.owner_of(business_id)
    if owner is None:
        return
    if owner != user["email"]:
        raise FriendlyError(
            "That business belongs to a different account. Check which Google "
            "account you're signed in with.", status=403)


# --------------------------------------------------------------------------
# Request models
# --------------------------------------------------------------------------
class CreateBusiness(BaseModel):
    name: str = ""


class SectionPayload(BaseModel):
    data: dict = {}
    # Set once the merchant has finished editing the business name (on blur), so
    # the slug is adopted from the settled name rather than from each keystroke.
    commit_slug: bool = False


class ShopifyConnect(BaseModel):
    subdomain: str = ""
    token: str = ""
    business_id: str = ""


class CustomConnect(BaseModel):
    base_url: str = ""
    auth_method: str = "api_key_header"
    header_name: str = "X-API-Key"
    business_id: str = ""


class ScrapeRequest(BaseModel):
    url: str = ""
    # Questions already on the merchant's list, so an import never duplicates them.
    existing_questions: list[str] = []


# --------------------------------------------------------------------------
# Sign-in
# --------------------------------------------------------------------------
@app.get("/api/auth/me")
def auth_me(request: Request):
    """Who is signed in, and whether signing in is even a thing here.

    Public, and the only endpoint the frontend can call before it has a
    session -- it is what tells the app whether to render a login screen or go
    straight in.
    """
    return {"user": _user(request), "auth_enabled": auth.enabled()}


@app.get("/api/auth/login")
def auth_login(request: Request, next: str = "/"):
    if not auth.enabled():
        raise FriendlyError(
            "Google sign-in isn't configured on this server.", status=503)
    url, nonce = auth.authorize_url(request, next)
    response = RedirectResponse(url, status_code=302)
    auth.set_state_cookie(response, request, nonce)
    return response


@app.get("/api/auth/callback")
def auth_callback(request: Request, code: str = "", state: str = "", error: str = ""):
    """Where Google sends the browser back.

    This is a redirect target, not an API call -- a human is looking at it. So
    every failure lands back on the login screen with a readable sentence in the
    query string rather than returning JSON to an empty tab.
    """
    if not auth.enabled():
        raise FriendlyError(
            "Google sign-in isn't configured on this server.", status=503)

    def back(message):
        response = RedirectResponse(
            "/?auth_error=" + urllib.parse.quote(message), status_code=302)
        auth.clear_state_cookie(response)
        return response

    if error:
        return back("Sign-in was cancelled." if error == "access_denied"
                    else "Google couldn't complete that sign-in.")
    if not code:
        return back("That sign-in link is incomplete. Please try again.")

    try:
        next_path = auth.read_state(state, request.cookies.get(auth.STATE_COOKIE))
        profile = auth.exchange_code(request, code)
    except auth.AuthError as exc:
        return back(str(exc))
    except Exception:
        log.exception("Google sign-in failed")
        return back("We couldn't complete that sign-in. Please try again.")

    log.info("signed in: %s (admin=%s)", profile["email"], auth.is_admin(profile["email"]))
    response = RedirectResponse(next_path, status_code=302)
    auth.set_session_cookie(response, request, auth.make_session(profile))
    auth.clear_state_cookie(response)
    return response


@app.post("/api/auth/logout")
def auth_logout():
    response = JSONResponse({"ok": True})
    auth.clear_session_cookie(response)
    return response


# --------------------------------------------------------------------------
# Meta
# --------------------------------------------------------------------------
@app.get("/api/health")
def health():
    return {"ok": True}


@app.get("/api/meta")
def meta():
    """Vocabulary the frontend renders from, so the two can never diverge."""
    return {
        "languages": constants.LANGUAGES,
        "categories": constants.CATEGORIES,
        "capabilities": constants.CAPABILITIES,
        "auth_methods": constants.AUTH_METHODS,
        "http_methods": constants.HTTP_METHODS,
        "default_errors": constants.DEFAULT_ERRORS,
        "section_labels": {str(k): v for k, v in constants.SECTION_LABELS.items()},
        "shopify_scopes": constants.SHOPIFY_SCOPES,
        "seeded_stores": vault.seeded_store_choices(),
    }


# --------------------------------------------------------------------------
# Businesses
# --------------------------------------------------------------------------
@app.get("/api/businesses")
def list_businesses(request: Request):
    user = _user(request)
    # An admin, and an unauthenticated deployment, both see everything.
    owner = None if (user is None or user["is_admin"]) else user["email"]
    return {"businesses": store.list_businesses(owner_email=owner)}


@app.post("/api/businesses")
def create_business(request: Request, payload: CreateBusiness):
    user = _user(request)
    business_id = store.create_business(
        name=(payload.name or "").strip(),
        owner_email=(user or {}).get("email", ""))
    biz = store.get_business(business_id)
    return {"business": biz, "summary": store.summarize(biz)}


@app.get("/api/business/{business_id}")
def get_business(request: Request, business_id: str):
    _require_owner(request, business_id)
    biz = store.get_business(business_id)
    if not biz:
        raise FriendlyError("We couldn't find that business.", status=404)
    return {
        "business": biz,
        "summary": store.summarize(biz),
        "statuses": {str(n): manifest_mod.section_status(n, biz["sections"])
                     for n in range(1, 8)},
        "completion": manifest_mod.completion_pct(biz["sections"]),
        "missing": manifest_mod.missing_items(biz["sections"]),
    }


@app.delete("/api/business/{business_id}")
def delete_business(request: Request, business_id: str):
    _require_owner(request, business_id)
    if not store.delete_business(business_id):
        raise FriendlyError("That business has already been removed.", status=404)
    # The published files are the merchant's public artifact. Leaving them on
    # disk means a deleted business stays published, and a later business that
    # adopts the same slug inherits a stranger's manifest.
    removed = []
    for name in ("{}.json".format(business_id), "{}.protocol.json".format(business_id)):
        path = os.path.join(MANIFEST_DIR, name)
        try:
            os.remove(path)
            removed.append(name)
        except FileNotFoundError:
            pass
        except OSError:
            log.warning("could not remove manifest %s", path)
    return {"ok": True, "files_removed": removed}


@app.put("/api/business/{business_id}/section/{section}")
def save_section(request: Request, business_id: str, section: str,
                 payload: SectionPayload):
    if section not in [str(n) for n in range(1, 8)]:
        raise FriendlyError("Unknown section '{}'.".format(section))
    _require_owner(request, business_id)
    biz = store.save_section(business_id, section, payload.data or {})
    if not biz:
        raise FriendlyError("We couldn't find that business.", status=404)

    # A business created from the home screen has no name yet, so it starts on a
    # placeholder id. Once the merchant names it, adopt the real slug -- the
    # business_id is what names the manifest file, the hosted URL and the vault
    # entry, so "Ravi Electronics" must not stay "your-business-7".
    if (section == "1" and payload.commit_slug and biz["status"] == "draft"
            and store.is_placeholder_id(business_id)):
        desired = manifest_mod.slugify((payload.data or {}).get("name"))
        if desired != store.PLACEHOLDER_SLUG:
            new_id = store.rename_business(business_id, store.unique_slug(desired))
            if new_id != business_id:
                business_id = new_id
                biz = store.get_business(business_id)

    _republish(biz)

    return {
        "ok": True,
        "business_id": business_id,
        "saved_at": biz["updated_at"],
        "statuses": {str(n): manifest_mod.section_status(n, biz["sections"])
                     for n in range(1, 8)},
        "completion": manifest_mod.completion_pct(biz["sections"]),
        "missing": manifest_mod.missing_items(biz["sections"]),
        "summary": store.summarize(biz),
    }


@app.get("/api/business/{business_id}/manifest")
def get_manifest(request: Request, business_id: str):
    _require_owner(request, business_id)
    biz = store.get_business(business_id)
    if not biz:
        raise FriendlyError("We couldn't find that business.", status=404)
    built = manifest_mod.assemble(biz["id"], biz["sections"],
                                 created_at=biz["created_at"])
    ok, errors = manifest_mod.validate(built)
    return {"manifest": built, "valid": ok, "errors": errors}


@app.post("/api/business/{business_id}/activate")
def activate(request: Request, business_id: str):
    _require_owner(request, business_id)
    biz = store.get_business(business_id)
    if not biz:
        raise FriendlyError("We couldn't find that business.", status=404)

    missing = manifest_mod.missing_items(biz["sections"])
    if missing:
        return {"ok": False,
                "error": "A few sections still need attention before you can activate.",
                "missing": missing}

    sections = biz["sections"]
    previous = (sections.get("7") or {}).get("version") or 0
    activation = {
        "activated": True,
        "activatedAt": store._now(),
        "version": previous + 1,
    }
    store.save_section(business_id, "7", activation)
    store.set_status(business_id, "active")

    biz = store.get_business(business_id)
    built = manifest_mod.assemble(biz["id"], biz["sections"], status="active",
                                 created_at=biz["created_at"])
    ok, errors = manifest_mod.validate(built)
    if not ok:
        # Roll the activation back rather than publish something invalid.
        activation["activated"] = False
        store.save_section(business_id, "7", activation)
        store.set_status(business_id, "draft")
        return {"ok": False,
                "error": "The manifest didn't pass validation, so nothing was published.",
                "errors": errors}

    flat_path, protocol_path = _write_manifest_files(business_id, built)

    return {
        "ok": True,
        "manifest": built,
        "version": activation["version"],
        "activated_at": activation["activatedAt"],
        "manifest_url": "{}/manifests/{}.json".format(PUBLIC_BASE_URL, business_id),
        # Relative to the repo when the manifests live inside it; on a mounted
        # volume that would render as a run of "../", so fall back to the name.
        "files": [_display_path(flat_path), _display_path(protocol_path)],
    }


# --------------------------------------------------------------------------
# Connections
# --------------------------------------------------------------------------
@app.post("/api/connect/shopify")
def connect_shopify(request: Request, payload: ShopifyConnect):
    """Real Shopify call. Returns 200 with ok:false on failure -- never a 500.

    The token is vaulted server-side; the response carries only credential_ref.
    """
    subdomain = (payload.subdomain or "").strip()
    token = (payload.token or "").strip()
    business_id = (payload.business_id or "").strip()
    # This writes a credential into a business's vault row, so it is as much a
    # mutation of that business as saving a section is.
    if business_id:
        _require_owner(request, business_id)

    # Demo path: a pre-seeded store connects without the merchant pasting a token,
    # which is the point -- merchants never handle raw secrets.
    if not token:
        token = vault.token_for_subdomain(subdomain) or ""
    if not token:
        # Without this the request reaches Shopify with an empty token and comes
        # back as a generic auth failure, which reads like the store is broken
        # rather than like nothing was supplied for it.
        return {"ok": False,
                "error": "That store isn't pre-configured here, so it needs its own "
                         "Admin API access token. Create one in Shopify under "
                         "Settings → Apps and sales channels → Develop apps."}

    try:
        result = shopify_client.verify_connection(subdomain, token)
    except shopify_client.ShopifyError as exc:
        return {"ok": False, "error": str(exc)}
    except Exception:
        log.exception("Shopify connect failed for %s", subdomain)
        return {"ok": False,
                "error": "We couldn't reach Shopify just now. Please try again."}

    credential_ref = ""
    if business_id and store.get_business(business_id):
        credential_ref = vault.put(business_id, token)
    elif business_id:
        credential_ref = vault.ref_for(business_id)

    return {
        "ok": True,
        "subdomain": result["subdomain"],
        "store": "{}.myshopify.com".format(result["subdomain"]),
        "shop_name": result["shop_name"],
        "product_count": result["product_count"],
        "order_count": result["order_count"],
        "currency": result["currency"],
        "credential_ref": credential_ref,
        "scopes": constants.SHOPIFY_SCOPES,
    }


@app.post("/api/connect/custom")
def connect_custom(request: Request, payload: CustomConnect):
    """Check that a custom REST base URL is reachable. Never a 500."""
    if (payload.business_id or "").strip():
        _require_owner(request, payload.business_id.strip())
    base = (payload.base_url or "").strip()
    if not base.startswith(("http://", "https://")):
        return {"ok": False, "reachable": False,
                "error": "Include https:// at the start of your base URL."}

    # The merchant controls this URL, so it is reached only after the host has
    # been resolved and shown to be public -- otherwise this endpoint is a probe
    # for anything the server itself can reach, including cloud metadata.
    try:
        scraper.assert_public_host(urllib.parse.urlsplit(base).hostname)
    except scraper.Blocked as exc:
        return {"ok": False, "reachable": False, "error": str(exc)}

    reachable = False
    detail = ""
    last_error = ""
    for attempt in range(3):
        try:
            request = urllib.request.Request(base, method="GET",
                                             headers={"User-Agent": "UCXP/1.0"})
            with urllib.request.urlopen(request, timeout=8) as response:
                reachable = True
                detail = "Responded with HTTP {}.".format(response.status)
            break
        except urllib.error.HTTPError as exc:
            # A 4xx/5xx still proves something is listening at that address.
            reachable = True
            detail = "Responded with HTTP {}.".format(exc.code)
            break
        except urllib.error.URLError as exc:
            last_error = str(getattr(exc, "reason", "")) or "no response"
        except Exception:
            last_error = "no response"

    credential_ref = ""
    business_id = (payload.business_id or "").strip()
    if business_id:
        credential_ref = vault.ref_for(business_id)

    if not reachable:
        return {
            "ok": True, "reachable": False,
            "credential_ref": credential_ref,
            "message": "We couldn't reach {} ({}). You can still save this and "
                       "connect later.".format(base, last_error),
        }
    return {"ok": True, "reachable": True, "credential_ref": credential_ref,
            "message": detail}


@app.post("/api/scrape-faq")
async def scrape_faq(payload: ScrapeRequest):
    """Draft a knowledge base from the merchant's own website.

    Never a 500 and never blocking: the merchant can always type Section 5 by
    hand, so every failure here is a 200 carrying one actionable sentence.
    """
    try:
        return await asyncio.wait_for(
            scraper.scrape(payload.url, payload.existing_questions),
            timeout=scraper.TOTAL_BUDGET_S,
        )
    except scraper.Blocked as exc:
        return {"ok": False, "error": str(exc)}
    except asyncio.TimeoutError:
        return {"ok": False,
                "error": "That site is taking too long to read. Try a single page, "
                         "like your FAQ page."}
    except Exception:
        log.exception("scrape-faq failed for %r", payload.url)
        return {"ok": False,
                "error": "We couldn't read that site just now. Please try again, "
                         "or add your FAQs below."}


# --------------------------------------------------------------------------
# Admin
# --------------------------------------------------------------------------
@app.get("/api/admin/merchants")
def admin_merchants(request: Request):
    _require_admin(request)
    merchants = store.list_businesses()
    return {
        "merchants": merchants,
        "stats": {
            "total": len(merchants),
            "active": sum(1 for m in merchants if m["status"] == "Active"),
            "drafts": sum(1 for m in merchants if m["status"] == "Draft"),
            "shopify": sum(1 for m in merchants if m["data_source"] == "shopify"),
        },
    }


@app.get("/api/admin/merchant/{business_id}/manifest")
def admin_manifest(request: Request, business_id: str):
    """Read-only manifest for the admin row-detail view."""
    _require_admin(request)
    biz = store.get_business(business_id)
    if not biz:
        raise FriendlyError("We couldn't find that merchant.", status=404)
    built = manifest_mod.assemble(biz["id"], biz["sections"],
                                 created_at=biz["created_at"])
    return {"manifest": built, "summary": store.summarize(biz)}


# --------------------------------------------------------------------------
# Static frontend -- mounted last so it can never shadow an /api route.
#
# Only active when a build exists at FRONTEND_DIST. Locally that directory is
# usually absent and Vite serves the app instead, so this is a no-op in dev.
# Serving the SPA from the same origin as the API is what lets the frontend keep
# calling a relative /api with no CORS involved at all.
# --------------------------------------------------------------------------
if os.path.isdir(FRONTEND_DIST):
    from fastapi.responses import FileResponse
    from fastapi.staticfiles import StaticFiles

    app.mount("/assets",
              StaticFiles(directory=os.path.join(FRONTEND_DIST, "assets")),
              name="assets")

    _INDEX = os.path.join(FRONTEND_DIST, "index.html")

    @app.get("/{full_path:path}", include_in_schema=False)
    def spa(full_path: str):
        """Serve the built app, falling back to index.html for client routes.

        The app uses BrowserRouter, so a hard refresh on /admin or
        /business/<id> arrives here as a real request for a path that has no
        file. Returning index.html lets the router resolve it in the browser.
        """
        if full_path.startswith("api/"):
            raise FriendlyError("Not found.", status=404)
        candidate = os.path.normpath(os.path.join(FRONTEND_DIST, full_path))
        # normpath collapses "..", so this rejects any attempt to escape the dir.
        if candidate.startswith(FRONTEND_DIST) and os.path.isfile(candidate):
            return FileResponse(candidate)
        return FileResponse(_INDEX)

    log.info("serving frontend from %s", FRONTEND_DIST)
