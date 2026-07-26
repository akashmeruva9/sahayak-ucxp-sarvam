"""FastAPI app for the UCXP merchant dashboard.

Error contract: every failure -- validation, upstream, or unexpected -- comes back
as {"error": "<friendly sentence>"}. A stack trace is never sent to a client, and
a bad Shopify token is a 200 with {"ok": false, "error": ...}, not a 500, because
the merchant needs to see the message inline rather than hit an error screen.
"""

import json
import logging
import os
import urllib.error
import urllib.request
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from . import constants, manifest as manifest_mod, shopify_client, store, vault

log = logging.getLogger("ucxp")

# backend lives at <repo>/Dashboard/backend, so the repo root is three levels up.
# manifests/, stores.json and ucxp.db all stay at the repo root.
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
MANIFEST_DIR = os.path.join(ROOT, "manifests")

ALLOWED_ORIGINS = [
    "http://localhost:5173", "http://127.0.0.1:5173",
    "http://localhost:4173", "http://127.0.0.1:4173",
]

@asynccontextmanager
async def lifespan(_app):
    store.init_db()
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
def list_businesses():
    return {"businesses": store.list_businesses()}


@app.post("/api/businesses")
def create_business(payload: CreateBusiness):
    business_id = store.create_business(name=(payload.name or "").strip())
    biz = store.get_business(business_id)
    return {"business": biz, "summary": store.summarize(biz)}


@app.get("/api/business/{business_id}")
def get_business(business_id: str):
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
def delete_business(business_id: str):
    if not store.delete_business(business_id):
        raise FriendlyError("That business has already been removed.", status=404)
    return {"ok": True}


@app.put("/api/business/{business_id}/section/{section}")
def save_section(business_id: str, section: str, payload: SectionPayload):
    if section not in [str(n) for n in range(1, 8)]:
        raise FriendlyError("Unknown section '{}'.".format(section))
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
def get_manifest(business_id: str):
    biz = store.get_business(business_id)
    if not biz:
        raise FriendlyError("We couldn't find that business.", status=404)
    built = manifest_mod.assemble(biz["id"], biz["sections"],
                                 created_at=biz["created_at"])
    ok, errors = manifest_mod.validate(built)
    return {"manifest": built, "valid": ok, "errors": errors}


@app.post("/api/business/{business_id}/activate")
def activate(business_id: str):
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

    os.makedirs(MANIFEST_DIR, exist_ok=True)
    flat_path = os.path.join(MANIFEST_DIR, "{}.json".format(business_id))
    protocol_path = os.path.join(MANIFEST_DIR, "{}.protocol.json".format(business_id))
    with open(flat_path, "w", encoding="utf-8") as handle:
        json.dump(built, handle, indent=2, ensure_ascii=False)
    with open(protocol_path, "w", encoding="utf-8") as handle:
        json.dump(manifest_mod.to_protocol(built), handle, indent=2, ensure_ascii=False)

    return {
        "ok": True,
        "manifest": built,
        "version": activation["version"],
        "activated_at": activation["activatedAt"],
        "manifest_url": "https://api.ucxp.in/manifests/{}.json".format(business_id),
        "files": [os.path.relpath(flat_path, ROOT),
                  os.path.relpath(protocol_path, ROOT)],
    }


# --------------------------------------------------------------------------
# Connections
# --------------------------------------------------------------------------
@app.post("/api/connect/shopify")
def connect_shopify(payload: ShopifyConnect):
    """Real Shopify call. Returns 200 with ok:false on failure -- never a 500.

    The token is vaulted server-side; the response carries only credential_ref.
    """
    subdomain = (payload.subdomain or "").strip()
    token = (payload.token or "").strip()
    business_id = (payload.business_id or "").strip()

    # Demo path: a pre-seeded store connects without the merchant pasting a token,
    # which is the point -- merchants never handle raw secrets.
    if not token:
        token = vault.token_for_subdomain(subdomain) or ""

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
def connect_custom(payload: CustomConnect):
    """Check that a custom REST base URL is reachable. Never a 500."""
    base = (payload.base_url or "").strip()
    if not base.startswith(("http://", "https://")):
        return {"ok": False, "reachable": False,
                "error": "Include https:// at the start of your base URL."}

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
def scrape_faq(payload: ScrapeRequest):
    """Stub FAQ drafter. Returns three editable drafts for the merchant to review."""
    url = (payload.url or "").strip()
    if not url.startswith(("http://", "https://")) or "." not in url:
        return {"ok": False,
                "error": "Enter a full URL, e.g. https://meenakshisilks.in/help"}
    return {
        "ok": True,
        "source": url,
        "faqs": [
            {"q": "What is your refund timeline?",
             "a": "Refunds reach your original payment method within 5–7 business "
                  "days of pickup.",
             "draft": True},
            {"q": "Can I exchange a saree for a different colour?",
             "a": "Yes — exchanges are free within 7 days if the piece is unworn "
                  "with tags intact.",
             "draft": True},
            {"q": "How do I care for Kanchipuram silk?",
             "a": "Dry-clean only. Store folded in muslin and re-fold every few months.",
             "draft": True},
        ],
    }


# --------------------------------------------------------------------------
# Admin
# --------------------------------------------------------------------------
@app.get("/api/admin/merchants")
def admin_merchants():
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
def admin_manifest(business_id: str):
    """Read-only manifest for the admin row-detail view."""
    biz = store.get_business(business_id)
    if not biz:
        raise FriendlyError("We couldn't find that merchant.", status=404)
    built = manifest_mod.assemble(biz["id"], biz["sections"],
                                 created_at=biz["created_at"])
    return {"manifest": built, "summary": store.summarize(biz)}
