"""support.manifest assembly, validation and protocol export.

Two artifacts come out of one business record:

  assemble()    -> the flat dashboard manifest (UCXP_Dashboard_Spec.md section 4,
                   with `capabilities` promoted from bare strings to full contract
                   objects so Section 3's editor has somewhere to live). This is
                   what the live JSON pane shows and what Download writes.

  to_protocol() -> the formal UCXP 0.1.0 schema from docs/02-manifest-spec.md,
                   written alongside the flat file on activation for the runtime.

Hard rule enforced by validate(): a raw Shopify token (shpat_...) must never
appear anywhere in either document. The manifest carries only a credential_ref.
"""

import json
import os
import re
from datetime import datetime, timezone

from .constants import (
    AUTH_METHODS,
    CAPABILITY_BY_KEY,
    SHOPIFY_AUTO_CAPABILITIES,
    CAPABILITY_KEYS,
    CATEGORIES,
    DEFAULT_ERRORS,
    DEFAULT_FIRST_RESPONSE_HOURS,
    DEFAULT_RESOLUTION_DAYS,
    EMITTED_LANGUAGES,
    INVALID_JSON_SENTINEL,
    LANGUAGE_CODES,
    SHOPIFY_SCOPES,
    to_bcp47,
)

UCXP_VERSION = "0.1"

# Where a published manifest is fetchable. Set UCXP_PUBLIC_BASE_URL to whatever
# actually serves this deployment; the default is the design's placeholder.
PUBLIC_BASE_URL = (os.environ.get("UCXP_PUBLIC_BASE_URL") or "https://api.ucxp.in").strip().rstrip("/")
PROTOCOL_VERSION = "0.1.0"
CREDENTIAL_REF_RE = re.compile(r"^vault://[a-z0-9-]{2,64}$")
EMAIL_RE = re.compile(r"^\S+@\S+\.\S+$")
URL_RE = re.compile(r"^https?://.+")
SECRET_PREFIXES = ("shpat_", "shpss_", "shpca_", "shppa_")


# --------------------------------------------------------------------------
# Slug
# --------------------------------------------------------------------------
def slugify(name):
    """Mirror of the design's slug rule: lowercase, '&' -> ' and ', non-alnum -> '-'."""
    text = (name or "").strip().lower().replace("&", " and ")
    text = re.sub(r"[^a-z0-9]+", "-", text).strip("-")
    return text or "your-business"


# --------------------------------------------------------------------------
# Section data shapes (the autosave unit)
# --------------------------------------------------------------------------
def empty_contract(key):
    """A blank, fully editable contract. Used for Custom REST and No-data-source.

    Nothing here is ever locked -- the merchant types the whole contract.
    """
    return {
        "name": key,
        "enabled": True,
        "source": "custom",
        "auto": False,
        "locked": False,
        "endpoint": "",
        "method": CAPABILITY_BY_KEY[key]["default_method"],
        "description": "",
        "parameters": {"path": [], "query": []},
        "request": {"headers": [], "body": ""},
        "response": {"sample": "", "mapping": []},
        "errors": [],
        "notes": "",
    }


def shopify_contract(key, slug, store_subdomain=""):
    """Contract seeded from a connected Shopify store.

    Starts `locked` so the merchant sees it is connector-managed, exactly as in
    the design. "Customize" flips locked to False and every field becomes
    editable -- nothing here is ever permanently read-only.

    Only the capabilities in SHOPIFY_AUTO_CAPABILITIES may use this. Shopify
    exposes no warranty or exchange endpoint, so those capabilities get a blank,
    editable contract from empty_contract() even when a store is connected.
    """
    if key not in SHOPIFY_AUTO_CAPABILITIES:
        return empty_contract(key)

    cap = CAPABILITY_BY_KEY[key]
    path = "/connectors/shopify/orders/{order_id}"
    if key == "refund":
        path = "/connectors/shopify/orders/{order_id}/refund"
    return {
        "name": key,
        "enabled": True,
        "source": "shopify_default",
        "auto": True,
        "locked": True,
        "endpoint": path,
        "method": cap["default_method"],
        "description": cap["description"],
        "parameters": {
            "path": [{
                "name": "order_id",
                "type": "string",
                "required": True,
                "example": "1001",
                "description": "Shopify order number. Customers are identified by order "
                               "number, never by name -- see identify_by.",
            }],
            "query": [],
        },
        "request": {
            "headers": [{"name": "X-Shopify-Access-Token", "value": "{{credential_ref}}"}],
            "body": cap["default_request"] if cap["default_method"] != "GET" else "",
        },
        "response": {
            "sample": cap["default_response"],
            "mapping": [
                {"field": "status", "path": "$.displayFulfillmentStatus"},
                {"field": "amount", "path": "$.totalPriceSet.shopMoney.amount"},
                {"field": "currency", "path": "$.totalPriceSet.shopMoney.currencyCode"},
            ],
        },
        "errors": [dict(err) for err in DEFAULT_ERRORS],
        "notes": "Auto-configured from Shopify store {}.".format(store_subdomain or slug),
    }


def default_sections():
    """The starting state of a brand-new business."""
    return {
        "1": {"name": "", "tagline": "", "desc": "", "category": "", "city": "",
              "email": "", "phone": "", "website": "", "hours": "", "logoUrl": ""},
        "2": {"type": "", "connected": False, "store": "", "base": "",
              "auth": "api_key_header", "header": "X-API-Key", "linkSent": False,
              "productCount": 0, "orderCount": 0, "currency": "",
              "credentialRef": ""},
        "3": {"caps": {}},
        "4": {"selected": [], "primary": ""},
        "5": {"faqs": [], "policies": {"return": "", "refund": "",
                                       "shipping": "", "warranty": ""}},
        "6": {"fr": DEFAULT_FIRST_RESPONSE_HOURS, "res": DEFAULT_RESOLUTION_DAYS,
              "gName": "", "gEmail": "", "auto": True},
        "7": {"activated": False, "activatedAt": "", "version": 0},
    }


# --------------------------------------------------------------------------
# Completion / section status  (mirrors the design's secStatus exactly)
# --------------------------------------------------------------------------
def _valid_json(text):
    if not (text or "").strip():
        return False
    try:
        json.loads(text)
        return True
    except (ValueError, TypeError):
        return False


def _enabled_caps(sections):
    caps = (sections.get("3") or {}).get("caps") or {}
    return {k: v for k, v in caps.items() if v and v.get("enabled")}


def capabilities_apply(sections):
    """Does section 3 mean anything for this business?

    A capability is the contract for an API call. With "No data source" there is
    no API to call -- the assistant answers from the knowledge base and hands off
    anything order-specific -- so section 3 is not a step the merchant skips past,
    it is not part of their setup at all. Everything that counts, shows, or
    publishes section 3 asks this first.
    """
    return ((sections or {}).get("2") or {}).get("type") != "none"


def section_status(n, sections):
    """Return 'done' | 'part' | 'empty' for section n."""
    s = sections or {}

    if n == 1:
        p = s.get("1") or {}
        if p.get("name") and p.get("category") and EMAIL_RE.match(p.get("email") or "") \
                and p.get("city"):
            return "done"
        keys = ["name", "tagline", "desc", "category", "email", "phone",
                "website", "hours", "city", "logoUrl"]
        return "part" if any(p.get(k) for k in keys) else "empty"

    if n == 2:
        d = s.get("2") or {}
        kind = d.get("type") or ""
        if kind == "none":
            return "done"
        if kind == "shopify" and d.get("connected"):
            return "done"
        if kind == "custom" and URL_RE.match(d.get("base") or ""):
            return "done"
        return "part" if kind else "empty"

    if n == 3:
        enabled = _enabled_caps(s)
        if not enabled:
            return "empty"
        every = all(
            (c.get("endpoint") or "").strip()
            and _valid_json(c.get("request", {}).get("body") or "{}")
            and _valid_json(c.get("response", {}).get("sample") or "")
            for c in enabled.values()
        )
        return "done" if every else "part"

    if n == 4:
        lang = s.get("4") or {}
        picked = lang.get("selected") or []
        if picked and lang.get("primary"):
            return "done"
        return "part" if picked else "empty"

    if n == 5:
        kb = s.get("5") or {}
        faqs = kb.get("faqs") or []
        policies = kb.get("policies") or {}
        has_faq = any((f.get("q") or "").strip() and (f.get("a") or "").strip() for f in faqs)
        has_policy = any((v or "").strip() for v in policies.values())
        any_content = bool(faqs) or has_policy
        if (has_faq or has_policy) and all(
                (f.get("q") or "").strip() and (f.get("a") or "").strip() for f in faqs):
            return "done"
        return "part" if any_content else "empty"

    if n == 6:
        e = s.get("6") or {}
        fr = str(e.get("fr") or "").strip()
        res = str(e.get("res") or "").strip()
        fr_ok = fr.isdigit() and int(fr) > 0
        res_ok = res.isdigit() and int(res) > 0
        if fr_ok and res_ok:
            return "done"
        return "part" if (fr_ok or res_ok) else "empty"

    if n == 7:
        return "done" if (s.get("7") or {}).get("activated") else "empty"

    return "empty"


_WEIGHT = {"done": 1.0, "part": 0.5, "empty": 0.0}


def _steps(sections, stop):
    """The sections that apply to this business, from 1 to stop-1."""
    return [n for n in range(1, stop)
            if n != 3 or capabilities_apply(sections)]


def completion_pct(sections):
    """Percent across sections 1-6. Section 7 is the activation itself, not progress."""
    steps = _steps(sections, 7)
    total = sum(_WEIGHT[section_status(n, sections)] for n in steps)
    return int(round(total / float(len(steps)) * 100))


def done_count(sections):
    """How many of all 7 sections are fully done."""
    return sum(1 for n in _steps(sections, 8)
               if section_status(n, sections) == "done")


def missing_items(sections):
    """Blocking items for activation, in the design's exact wording."""
    s = sections or {}
    out = []

    p = s.get("1") or {}
    need = []
    if not p.get("name"):
        need.append("business name")
    if not p.get("category"):
        need.append("category")
    if not EMAIL_RE.match(p.get("email") or ""):
        need.append("a valid support email")
    if not p.get("city"):
        need.append("city")
    if need:
        out.append({"section": 1, "text": "Business profile — add " + ", ".join(need)})

    d = s.get("2") or {}
    kind = d.get("type") or ""
    if kind == "shopify" and not d.get("connected"):
        out.append({"section": 2, "text": "Data source — finish connecting Shopify"})
    elif kind == "custom" and not URL_RE.match(d.get("base") or ""):
        out.append({"section": 2, "text": "Data source — add a valid base URL (https://…)"})
    elif not kind:
        out.append({"section": 2,
                    "text": 'Data source — choose Shopify, a custom API, or "No data source"'})

    # A business with a data source but no capabilities activates into a manifest
    # with no "capabilities" key at all -- live, and unable to do anything. With
    # no data source it is a legitimate configuration: the assistant answers from
    # the knowledge base and hands off anything order-specific, so do not block it.
    if kind in ("shopify", "custom"):
        caps = (s.get("3") or {}).get("caps") or {}
        if not any((cap or {}).get("enabled") for cap in caps.values()):
            out.append({"section": 3,
                        "text": "API capabilities — enable at least one capability"})

    lang = s.get("4") or {}
    if not (lang.get("selected") and lang.get("primary")):
        out.append({"section": 4, "text": "Languages — select at least one and set a primary"})

    if section_status(6, s) != "done":
        out.append({"section": 6,
                    "text": "Escalation & SLA — set response and resolution times"})

    return out


# --------------------------------------------------------------------------
# Assembly
# --------------------------------------------------------------------------
def _maybe_json(text):
    """Parse an example body; keep the design's sentinel for invalid JSON."""
    raw = (text or "").strip()
    if not raw:
        return None
    try:
        return json.loads(raw)
    except (ValueError, TypeError):
        return INVALID_JSON_SENTINEL


def _prune(value):
    """Drop empty strings, empty lists/dicts and Nones so the preview stays readable."""
    if isinstance(value, dict):
        out = {}
        for k, v in value.items():
            cleaned = _prune(v)
            if cleaned not in (None, "", [], {}):
                out[k] = cleaned
        return out
    if isinstance(value, list):
        return [_prune(v) for v in value if _prune(v) not in (None, "", [], {})]
    return value


def _contract_to_manifest(contract):
    """Serialize one capability contract for the manifest."""
    out = {
        "name": contract.get("name"),
        "source": contract.get("source") or "custom",
        "endpoint": contract.get("endpoint") or "",
        "method": contract.get("method") or "GET",
        "description": contract.get("description") or "",
        "parameters": {
            "path": [
                {
                    "name": p.get("name") or "",
                    "type": p.get("type") or "string",
                    "required": bool(p.get("required")),
                    "example": p.get("example") or "",
                    "description": p.get("description") or "",
                }
                for p in (contract.get("parameters") or {}).get("path") or []
                if (p.get("name") or "").strip()
            ],
            "query": [
                {
                    "name": p.get("name") or "",
                    "type": p.get("type") or "string",
                    "required": bool(p.get("required")),
                    "example": p.get("example") or "",
                    "description": p.get("description") or "",
                }
                for p in (contract.get("parameters") or {}).get("query") or []
                if (p.get("name") or "").strip()
            ],
        },
        "request": {
            "headers": {
                h.get("name"): h.get("value")
                for h in (contract.get("request") or {}).get("headers") or []
                if (h.get("name") or "").strip()
            },
            "body": _maybe_json((contract.get("request") or {}).get("body")),
        },
        "response": {
            "example": _maybe_json((contract.get("response") or {}).get("sample")),
            "mapping": {
                m.get("field"): m.get("path")
                for m in (contract.get("response") or {}).get("mapping") or []
                if (m.get("field") or "").strip()
            },
        },
        "errors": [
            {
                "code": str(e.get("code") or ""),
                "meaning": e.get("meaning") or "",
                "customer_message": e.get("customer_message") or "",
            }
            for e in contract.get("errors") or []
            if str(e.get("code") or "").strip()
        ],
        "notes": contract.get("notes") or "",
    }
    return _prune(out)


def assemble(business_id, sections, status=None, created_at=None):
    """Build the flat dashboard manifest from stored section data."""
    s = sections or {}
    profile = s.get("1") or {}
    ds = s.get("2") or {}
    langs = s.get("4") or {}
    kb = s.get("5") or {}
    esc = s.get("6") or {}
    act = s.get("7") or {}

    slug = business_id or slugify(profile.get("name"))
    selected = [c for c in (langs.get("selected") or []) if c in LANGUAGE_CODES]
    primary = langs.get("primary") if langs.get("primary") in selected else (
        selected[0] if selected else "")

    # --- data_source: credential_ref only, never a token ---
    kind = ds.get("type") or ""
    data_source = {"type": kind or "unset"}
    if kind == "shopify":
        data_source.update({
            "store_subdomain": ds.get("store") or "",
            "credential_ref": ds.get("credentialRef") or "vault://{}".format(slug),
            "reads": list(SHOPIFY_SCOPES),
            "pii_available": False,
        })
    elif kind == "custom":
        auth_key = ds.get("auth") or "api_key_header"
        data_source.update({
            "base_url": ds.get("base") or "",
            "auth_method": auth_key,
            "auth_header": ds.get("header") or "",
            "credential_ref": "vault://{}".format(slug),
            "pii_available": False,
        })
    elif kind == "none":
        data_source.update({"reads": [], "pii_available": False})

    # A merchant who connected Shopify, enabled capabilities, then switched to
    # "No data source" still has those contracts saved. Publishing them would
    # advertise calls the runtime has no way to make. They stay in the section so
    # that reconnecting a source restores the work -- they just never ship.
    caps_store = {} if kind == "none" else ((s.get("3") or {}).get("caps") or {})
    capabilities = [
        _contract_to_manifest(caps_store[key])
        for key in CAPABILITY_KEYS
        if caps_store.get(key) and caps_store[key].get("enabled")
    ]

    faqs = [
        {"q": (f.get("q") or "").strip(), "a": (f.get("a") or "").strip()}
        for f in (kb.get("faqs") or [])
        if (f.get("q") or "").strip() or (f.get("a") or "").strip()
    ]
    raw_policies = kb.get("policies") or {}
    policies = {
        "return_policy": raw_policies.get("return") or "",
        "refund_policy": raw_policies.get("refund") or "",
        "shipping_policy": raw_policies.get("shipping") or "",
        "warranty": raw_policies.get("warranty") or "",
    }

    fr = str(esc.get("fr") or DEFAULT_FIRST_RESPONSE_HOURS)
    res = str(esc.get("res") or DEFAULT_RESOLUTION_DAYS)
    ladder = [
        {"level": 1, "to": "support agent", "after": "0h"},
        {"level": 2, "to": "grievance officer", "after": "{}h".format(fr)},
        {"level": 3, "to": "National Consumer Helpline 1915", "after": "{}d".format(res)},
    ]
    if esc.get("gName"):
        ladder[1]["name"] = esc["gName"]
    if esc.get("gEmail"):
        ladder[1]["contact"] = esc["gEmail"]

    # Text pasted into a form routinely arrives with a stray leading space, and
    # nobody ever means to name their shop " Ravi Electronics". The logo is a
    # base64 data URL, so it is deliberately left alone.
    def text(key):
        return (profile.get(key) or "").strip()

    manifest = {
        "ucxp_version": UCXP_VERSION,
        "business": text("name"),
        "business_id": slug,
        "category": text("category"),
        "profile": {
            "tagline": text("tagline"),
            "description": text("desc"),
            "support_email": text("email"),
            "support_phone": text("phone"),
            "website": text("website"),
            "hours": text("hours"),
            "city": text("city"),
            "logo_url": profile.get("logoUrl") or "",
        },
        "primary_language": to_bcp47(primary) if primary else "",
        "languages": [to_bcp47(c) for c in selected],
        "data_source": data_source,
        # Shopify Basic blocks customer PII, so customers are matched by order
        # number. The runtime must not attempt name lookups.
        "identify_by": "order_number",
        "capabilities": capabilities,
        "policies": policies,
        "faq": faqs,
        "sla": {"first_response": "{}h".format(fr), "resolution": "{}d".format(res),
                "auto_escalate": bool(esc.get("auto", True))},
        "escalation": ladder,
        "created_at": created_at or datetime.now(timezone.utc).strftime(
            "%Y-%m-%dT%H:%M:%SZ"),
        "status": status or ("active" if act.get("activated") else "draft"),
    }
    if act.get("activated"):
        manifest["published"] = {
            "version": act.get("version") or 1,
            "at": act.get("activatedAt") or "",
            "url": "{}/manifests/{}.json".format(PUBLIC_BASE_URL, slug),
        }
    return _prune(manifest)


# --------------------------------------------------------------------------
# Validation
# --------------------------------------------------------------------------
def _walk_strings(value):
    if isinstance(value, dict):
        for k, v in value.items():
            yield str(k)
            for item in _walk_strings(v):
                yield item
    elif isinstance(value, list):
        for v in value:
            for item in _walk_strings(v):
                yield item
    elif isinstance(value, str):
        yield value


def validate(manifest):
    """Return (ok, errors). Fails closed -- a bad manifest is never published."""
    errors = []
    if not isinstance(manifest, dict):
        return False, ["Manifest must be a JSON object."]

    for key in ("ucxp_version", "business_id", "identify_by", "status"):
        if not manifest.get(key):
            errors.append("Missing required field: {}".format(key))

    bid = manifest.get("business_id") or ""
    if bid and not re.match(r"^[a-z0-9_-]{2,64}$", bid):
        errors.append("business_id '{}' must be a lowercase slug.".format(bid))

    if manifest.get("identify_by") and manifest["identify_by"] != "order_number":
        errors.append("identify_by must be 'order_number' (Shopify Basic blocks customer PII).")

    # Compare against the codes we actually emit, rather than splitting the
    # locale off and checking the prefix. Odia is the reason: we key on the ISO
    # 'or' internally but write Sarvam's 'od-IN', so a prefix check looked for
    # 'od' in a list that has 'or' and rejected every manifest offering Odia.
    for code in manifest.get("languages") or []:
        if code not in EMITTED_LANGUAGES:
            errors.append("Unsupported language code: {}".format(code))
    primary = manifest.get("primary_language")
    if primary and primary not in (manifest.get("languages") or []):
        errors.append("primary_language '{}' is not in the selected languages.".format(primary))

    ds = manifest.get("data_source") or {}
    if ds.get("type") not in ("shopify", "custom", "none", "unset", None):
        errors.append("data_source.type '{}' is not recognised.".format(ds.get("type")))
    ref = ds.get("credential_ref")
    if ref and not CREDENTIAL_REF_RE.match(ref):
        errors.append("credential_ref '{}' must look like vault://<business_id>.".format(ref))
    if ds.get("type") in ("shopify", "custom") and not ref:
        errors.append("A connected data source must carry a credential_ref.")
    if ds.get("pii_available") is True:
        errors.append("pii_available must be false — customer PII is never read.")

    for cap in manifest.get("capabilities") or []:
        name = cap.get("name")
        if name not in CAPABILITY_KEYS:
            errors.append("Unknown capability '{}'.".format(name))
        if cap.get("request", {}).get("body") == INVALID_JSON_SENTINEL:
            errors.append("Capability '{}' has an invalid JSON request body.".format(name))
        if cap.get("response", {}).get("example") == INVALID_JSON_SENTINEL:
            errors.append("Capability '{}' has an invalid JSON response example.".format(name))

    # The security invariant: no raw secret may ever reach a manifest file.
    for text in _walk_strings(manifest):
        for prefix in SECRET_PREFIXES:
            if prefix in text:
                errors.append(
                    "A raw API token was found in the manifest. Only credential_ref "
                    "may be published.")
                break
        else:
            continue
        break

    return (len(errors) == 0), errors


# --------------------------------------------------------------------------
# Protocol export (docs/02-manifest-spec.md shape)
# --------------------------------------------------------------------------
def _binding_headers(headers):
    out = {}
    for name, value in (headers or {}).items():
        if value == "{{credential_ref}}":
            out[name] = {"from": "auth", "name": "credential_ref", "required": True}
        else:
            out[name] = {"from": "constant", "value": value}
    return out


def to_protocol(flat):
    """Map the flat dashboard manifest onto the formal UCXP 0.1.0 protocol schema."""
    ds = flat.get("data_source") or {}
    # Section 2 stores whatever Shopify returned, which is the full domain
    # ("acme.myshopify.com"). Strip it before re-adding, or the base URL doubles.
    subdomain = (ds.get("store_subdomain") or "").removesuffix(".myshopify.com")
    base_url = ds.get("base_url") or (
        "https://{}.myshopify.com/admin/api/2026-01".format(subdomain)
        if subdomain else "{}/{}".format(
            PUBLIC_BASE_URL, flat.get("business_id", "business")))

    api_mappings = {}
    capabilities = []
    for cap in flat.get("capabilities") or []:
        name = cap.get("name")
        mapping_id = "{}_call".format(name)
        params = {}
        required = []
        for p in (cap.get("parameters") or {}).get("path", []) + \
                (cap.get("parameters") or {}).get("query", []):
            params[p["name"]] = {
                "type": p.get("type") or "string",
                "description": p.get("description") or "",
                "example": p.get("example") or "",
            }
            if p.get("required"):
                required.append(p["name"])

        errors_block = {}
        for err in cap.get("errors") or []:
            errors_block[str(err.get("code"))] = {
                "text": err.get("customer_message") or "", "localize": True}
        errors_block.setdefault("default", {
            "text": "Sorry, I couldn't complete that right now. Please try again shortly.",
            "localize": True})

        api_mappings[mapping_id] = _prune({
            "method": cap.get("method") or "GET",
            "path": cap.get("endpoint") or "",
            "request": {
                "path_params": {
                    p["name"]: {"from": "param", "name": p["name"],
                                "required": bool(p.get("required"))}
                    for p in (cap.get("parameters") or {}).get("path", [])
                },
                "query_params": {
                    p["name"]: {"from": "param", "name": p["name"],
                                "required": bool(p.get("required"))}
                    for p in (cap.get("parameters") or {}).get("query", [])
                },
                "headers": _binding_headers((cap.get("request") or {}).get("headers")),
            },
            "timeout_ms": 8000,
            "success_when": "http_status < 300",
            "response_template": {
                "success": {"text": "Here is what I found for your request.", "localize": True},
                "errors": errors_block,
            },
        })

        capabilities.append(_prune({
            "name": name,
            "description": cap.get("description") or CAPABILITY_BY_KEY.get(
                name, {}).get("description", ""),
            "requires_auth": False,
            "parameters": {"type": "object", "properties": params, "required": required},
            "action": {"api_mapping": mapping_id},
        }))

    knowledge = {
        "faqs": [
            {"id": "faq_{}".format(i + 1), "question": f.get("q"), "answer": f.get("a")}
            for i, f in enumerate(flat.get("faq") or [])
        ],
        "policies": [
            {"id": key, "title": key.replace("_", " ").title(), "body": body}
            for key, body in (flat.get("policies") or {}).items() if body
        ],
    }

    escalation_rules = []
    for rung in flat.get("escalation") or []:
        escalation_rules.append(_prune({
            "id": "rung_{}".format(rung.get("level")),
            "when": {1: "user_requests_human", 2: "sla_first_response_breached"}.get(
                rung.get("level"), "sla_resolution_breached"),
            "action": "human_handoff",
            "target": rung.get("contact") or rung.get("to"),
            "message": {"text": "Connecting you with {}.".format(rung.get("to")),
                        "localize": True},
        }))

    return _prune({
        "ucxp_version": PROTOCOL_VERSION,
        "manifest_version": "1.{}.0".format((flat.get("published") or {}).get("version", 1)),
        "generated_at": flat.get("created_at"),
        "business": {
            "id": flat.get("business_id"),
            "name": flat.get("business"),
            "category": flat.get("category"),
            "description": (flat.get("profile") or {}).get("description"),
            "support_hours": (flat.get("profile") or {}).get("hours"),
            "api_base_url": base_url,
        },
        "auth": {
            "default_method": "connector",
            "methods": [{
                "id": "connector",
                "type": "api_key",
                "label": "UCXP vault credential",
                "establishes": ["credential_ref"],
            }],
        },
        "supported_languages": flat.get("languages") or [],
        "defaults": {
            "language": flat.get("primary_language"),
            "confirmation_required_for_destructive": True,
            "request_timeout_ms": 8000,
        },
        "capabilities": capabilities,
        "api_mappings": api_mappings,
        "knowledge": knowledge,
        "escalation_rules": escalation_rules,
        "metadata": {
            "generated_by": "ucxp-dashboard",
            "identify_by": flat.get("identify_by"),
            "pii_available": False,
            "data_source": flat.get("data_source"),
        },
    })
