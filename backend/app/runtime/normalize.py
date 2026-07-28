"""Adapt a published (Shopify-style) UCXP manifest to the internal model.

The runtime graph consumes the classic :class:`Manifest` shape (PLAN.md §5):
``business.id``, capabilities with ``id``/``action``/``required_inputs``,
``endpoints[]``, ``knowledge[]``. Manifests published by the UCXP onboarding
tool use a richer, connector-oriented shape — ``business`` is a name string,
capabilities carry ``name``/``endpoint``/``parameters``/``response``, plus
``profile``/``policies``/``faq``/``data_source``.

Rather than teach the graph two shapes, we normalise the published shape into
the internal one here, at load time. Nothing downstream changes, and this stays
business-generic — it maps *structure*, never a specific business.
"""

from __future__ import annotations

import re
from typing import Any

# Verbs that mutate state — the runtime confirms these before executing.
_DESTRUCTIVE = ("refund", "cancel", "delete", "return", "close", "unsubscribe")

# Substring → glyph/color, matched against the (lowercased) category so a
# "Food & Beverage" or "Apparel & Textiles" still gets an intentional look.
_CATEGORY_STYLE: list[tuple[str, tuple[str, str]]] = [
    ("electronic", ("🔌", "#2563EB")),
    ("fashion", ("👗", "#FF3F6C")),
    ("apparel", ("👗", "#FF3F6C")),
    ("textile", ("🧵", "#DB2777")),
    ("grocer", ("🛒", "#16A34A")),
    ("food", ("🍽", "#FC8019")),
    ("beverage", ("🥤", "#F97316")),
    ("kitchen", ("🍳", "#D97706")),
    ("home", ("🏠", "#0891B2")),
    ("living", ("🛋", "#0891B2")),
    ("pharma", ("💊", "#10847E")),
    ("wellness", ("🌿", "#0EA66E")),
    ("ayurved", ("🌿", "#0EA66E")),
    ("health", ("🩺", "#0EA66E")),
    ("shopping", ("🛍", "#2874F0")),
]
_DEFAULT_STYLE = ("🏢", "#64748B")


def is_published_shape(raw: dict[str, Any]) -> bool:
    """The published shape uses a business *name string* + a separate id."""
    return isinstance(raw.get("business"), str) or "business_id" in raw


def _style(category: str) -> tuple[str, str]:
    lc = (category or "").strip().lower()
    for needle, style in _CATEGORY_STYLE:
        if needle in lc:
            return style
    return _DEFAULT_STYLE


def _friendly(name: str) -> str:
    """`order_number` → `order number`, `track_order` → `track order`."""
    return name.replace("_", " ").replace("-", " ").strip()


def _input_prompt(param: dict[str, Any]) -> str:
    label = _friendly(param.get("name", "detail"))
    example = param.get("example")
    ask = f"What's your {label}?"
    return f"{ask} (for example {example})" if example else ask


def _receipt_for(cap_name: str) -> dict[str, Any] | None:
    """A best-effort receipt referencing a field the connector returns.

    render() is strict, so if the field is absent at compose time the receipt is
    simply dropped (handled in graph._receipt) — never a broken card.
    """
    lname = cap_name.lower()
    if any(v in lname for v in ("track", "status", "order", "where")):
        return {"label": "{{result.status}}", "tone": "success"}
    if "refund" in lname:
        return {"label": "Refund {{result.status}} · ref {{result.refund_id}}", "tone": "success"}
    if "cancel" in lname:
        return {"label": "{{result.status}}", "tone": "warning"}
    return None


def _knowledge(raw: dict[str, Any]) -> list[dict[str, str]]:
    items: list[dict[str, str]] = []
    profile = raw.get("profile") or {}
    if profile.get("description"):
        items.append({"id": "about", "text": profile["description"]})
    for key, value in (raw.get("policies") or {}).items():
        if isinstance(value, str) and value.strip():
            items.append({"id": key, "text": value.strip()})
    for i, entry in enumerate(raw.get("faq") or []):
        q, a = entry.get("q"), entry.get("a")
        if q and a:
            items.append({"id": f"faq_{i}", "text": f"{q} {a}"})
    return items


def _endpoint_url(path: str, business_id: str, data_source: dict[str, Any]) -> str:
    """Map a published capability endpoint to a runtime-callable URL template.

    Path params use single braces (`{order_id}`); the renderer uses double, so
    convert. A `shopify` data_source is routed to the local Shopify connector
    with the business id embedded (`/connectors/shopify/{business_id}/…`), so
    the connector can resolve that store's credential and call the real Admin
    API (or fall back to mock). Anything else is rooted at {{mock_base}}.
    """
    templated = re.sub(r"\{(\w+)\}", r"{{\1}}", path or "")
    if not templated.startswith("/"):
        templated = "/" + templated

    if (data_source.get("type") or "").lower() == "shopify":
        # /connectors/shopify/orders/{{order_id}} → /connectors/shopify/<biz>/orders/{{order_id}}
        tail = re.sub(r"^/connectors/shopify", "", templated) or "/"
        return f"{{{{connector_base}}}}/connectors/shopify/{business_id}{tail}"

    return "{{mock_base}}" + templated



#: Fields worth putting in a spoken sentence, in the order they read naturally.
#: Keyed on what the published manifest's own `response.example` declares, so
#: this stays data-driven — no business, and no capability, is named here.
_SENTENCE_FIELDS: list[tuple[str, str]] = [
    ("status", "is {{result.status}}"),
    ("eta", "arriving {{result.eta}}"),
    ("amount", "for {{result.amount}} {{result.currency}}"),
    ("eta_days", "and should complete in {{result.eta_days}} days"),
]


def _response_template(cap: dict) -> str:
    """Build a response template from the capability's declared example fields.

    Published manifests describe their API response shape (`{example, mapping}`)
    rather than carrying a sentence. Without a template the composer has nothing
    to say, so it falls through to a full reasoning call on *every* turn — about
    25-40s with sarvam-105b. Synthesising a sentence from the fields the
    manifest already declares keeps completed jobs instant and deterministic,
    and the LLM stays available for the cases with genuinely nothing to render.
    """
    response = cap.get("response")
    example = response.get("example") if isinstance(response, dict) else None
    if not isinstance(example, dict):
        return ""

    # The subject: whichever identifier the response echoes back.
    subject = next(
        (k for k in ("order_id", "refund_id", "booking_ref", "ticket_id") if k in example),
        None,
    )
    lead = f"Your order {{{{{subject}}}}}" if subject == "order_id" else (
        f"Your request {{{{result.{subject}}}}}" if subject else "Your request"
    )

    parts = [
        phrase
        for field, phrase in _SENTENCE_FIELDS
        if field in example and (field != "amount" or "currency" in example)
    ]
    if not parts:
        return ""
    return f"{lead} {', '.join(parts)}."

def normalize(raw: dict[str, Any]) -> dict[str, Any]:
    """Return an internal-shape manifest dict for :class:`Manifest`."""
    name: str = raw.get("business") if isinstance(raw.get("business"), str) else raw.get("business_id", "Business")
    business_id: str = raw.get("business_id") or re.sub(r"\s+", "-", name.lower())
    category: str = raw.get("category", "Other")
    languages = raw.get("languages") or [raw.get("primary_language", "en-IN")]
    data_source = raw.get("data_source") or {}
    glyph, color = _style(category)

    # Routing hints: the published shape has none, so derive deterministic ones.
    aliases = {name, business_id, business_id.replace("-", " "), name.split()[0]}
    domains = [category.lower()] + [_friendly(c.get("name", "")) for c in raw.get("capabilities", [])]

    capabilities: list[dict[str, Any]] = []
    endpoints: list[dict[str, Any]] = []
    for cap in raw.get("capabilities", []):
        cap_name = cap.get("name")
        if not cap_name:
            continue
        description = cap.get("description") or _friendly(cap_name).capitalize()

        params = cap.get("parameters") or {}
        required_inputs: list[dict[str, Any]] = []
        for group in ("path", "query", "body"):
            for param in params.get(group) or []:
                required_inputs.append({
                    "name": param["name"],
                    "type": param.get("type", "string"),
                    "prompt": _input_prompt(param),
                    "optional": not param.get("required", group == "query"),
                })

        endpoint_id = cap_name
        endpoints.append({
            "id": endpoint_id,
            "method": cap.get("method", "GET").upper(),
            "url": _endpoint_url(cap.get("endpoint", ""), business_id, data_source),
            "headers": {},  # auth is a connector concern; the mock ignores it
            "body": None,   # identifiers travel in the path; POSTs need no body
            "timeout_s": 8.0,
        })

        capabilities.append({
            "id": cap_name,
            "description": description,
            "examples": [],
            "required_inputs": required_inputs,
            "rules": [],
            "confirm": any(v in cap_name.lower() for v in _DESTRUCTIVE),
            "action": endpoint_id,
            "response": _response_template(cap),
            "receipt": _receipt_for(cap_name),
        })

    escalation_msg = "I'm handing this to a human agent — they'll follow up shortly."
    for level in raw.get("escalation") or []:
        if isinstance(level, dict) and level.get("contact"):
            escalation_msg = (
                f"I'm escalating this to {level.get('to', 'our team')} "
                f"({level['contact']}) — they'll follow up shortly."
            )
            break

    return {
        "ucxp_version": raw.get("ucxp_version", "0.1"),
        "business": {
            "id": business_id,
            "name": name,
            "category": category,
            "glyph": glyph,
            "color": color,
            "languages": languages,
        },
        "routing": {
            "aliases": sorted(a for a in aliases if a),
            "domains": sorted(set(d for d in domains if d)),
        },
        "auth": {"type": "none", "identity_fields": [raw.get("identify_by", "order_number")]},
        "capabilities": capabilities,
        "endpoints": endpoints,
        "knowledge": _knowledge(raw),
        "escalation": {
            "when": ["action_failed", "user_asks_human"],
            "message": escalation_msg,
            "action": None,
        },
    }
