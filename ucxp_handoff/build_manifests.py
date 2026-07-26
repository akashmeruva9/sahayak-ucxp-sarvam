"""Generate UCXP manifests + mock-API seed data for the 5 real Shopify stores.

Manifest shape follows sahayak-ucxp-sarvam/PLAN.md section 5 — the runtime's
declared contract. Product/order facts come from the live Shopify Admin API;
policy and FAQ text is plausible filler and is marked as such in the README.

    python3.13 build_manifests.py            # reads real_data.json, writes manifests/ + seed/

Regenerate real_data.json with dump_shopify.py whenever the stores change.
"""
from __future__ import annotations

import json
import pathlib
from datetime import datetime, timedelta, timezone

HERE = pathlib.Path(__file__).parent
REAL = json.loads((HERE / "real_data.json").read_text())

UCXP_VERSION = "0.1"
LANGUAGES = ["en-IN", "hi-IN", "te-IN", "ta-IN"]

# Orders that are Shopify's built-in sample data rather than the merchant's own
# catalogue. Kept in the seed for fidelity, flagged so nobody demos them.
JUNK_MARKERS = ("Snowboard", "Ski Wax")


# --------------------------------------------------------------------------- #
# Per-business profile: identity, capabilities, and filler knowledge.
# --------------------------------------------------------------------------- #
PROFILES = {
    "meena-kitchen": {
        "category": "Kitchen",
        "glyph": "🍳",
        "color": "#E0632B",
        "aliases": ["meena", "meena kitchen", "meena kitchen store",
                    "మీనా కిచెన్", "मीना किचन"],
        "domains": ["order", "delivery", "cooker", "mixer", "kitchen", "refund", "cancel"],
        "capabilities": ["track_order", "request_refund", "cancel_order"],
        "knowledge": [
            ("return_policy", "Kitchen appliances can be returned within 7 days of delivery if unused and in original packaging."),
            ("refund_policy", "Approved refunds are credited to the original payment method within 5-7 business days."),
            ("warranty", "All appliances carry a 1 year manufacturer warranty handled by the brand service centre."),
            ("delivery", "Orders are delivered across Telangana and Andhra Pradesh within 3-5 working days."),
        ],
    },
    "lakshmi-fashion": {
        "category": "Fashion",
        "glyph": "👗",
        "color": "#C2185B",
        "aliases": ["lakshmi", "lakshmi fashion", "లక్ష్మి ఫ్యాషన్", "लक्ष्मी फैशन"],
        "domains": ["order", "saree", "kurta", "dress", "size", "exchange", "return"],
        "capabilities": ["track_order", "request_exchange", "cancel_order"],
        "knowledge": [
            ("return_policy", "Clothing can be returned or exchanged within 7 days if unworn and with original tags attached."),
            ("exchange_policy", "One free size exchange is allowed per order. Pickup is arranged within 48 hours."),
            ("colour_note", "Fabric colours may vary slightly from photographs because of screen differences."),
            ("delivery", "Orders ship within 2 working days and arrive in 4-6 days statewide."),
        ],
    },
    "ravi-electronics": {
        "category": "Electronics",
        "glyph": "🎧",
        "color": "#1E5EFF",
        "aliases": ["ravi", "ravi electronics", "రవి ఎలక్ట్రానిక్స్", "रवि इलेक्ट्रॉनिक्स"],
        "domains": ["order", "earbuds", "power bank", "smartwatch", "warranty", "refund"],
        "capabilities": ["track_order", "request_refund", "warranty_claim"],
        "knowledge": [
            ("return_policy", "Electronics can be returned within 10 days if unopened. Opened items are accepted only if defective."),
            ("refund_policy", "Refunds are processed within 5-7 business days after the item passes inspection."),
            ("warranty", "Every product carries a 1 year manufacturer warranty. Keep the invoice for claims."),
            ("cod", "Cash on delivery is available for orders under 10000 rupees."),
        ],
    },
    "sri-pharma": {
        "category": "Pharmacy",
        "glyph": "💊",
        "color": "#0B8A5B",
        "aliases": ["sri pharma", "sri", "శ్రీ ఫార్మా", "श्री फार्मा"],
        "domains": ["order", "medicine", "prescription", "refill", "reorder", "delivery"],
        "capabilities": ["track_order", "reorder_prescription", "cancel_order"],
        "knowledge": [
            ("return_policy", "For safety reasons medicines cannot be returned once delivered, except for damaged or expired stock reported within 24 hours."),
            ("prescription", "Prescription medicines require a valid doctor's prescription uploaded before dispatch."),
            ("delivery", "Medicines are delivered the same day within city limits and next day elsewhere."),
            ("storage", "Cold-chain items are shipped in insulated packaging and must be refrigerated on arrival."),
        ],
    },
    "anna-groceries": {
        "category": "Grocery",
        "glyph": "🛒",
        "color": "#E0A800",
        "aliases": ["anna", "anna groceries", "అన్న గ్రోసరీస్", "अन्ना ग्रोसरीज़"],
        "domains": ["order", "rice", "dal", "oil", "grocery", "reorder", "delivery"],
        "capabilities": ["track_order", "reorder", "cancel_order"],
        "knowledge": [
            ("return_policy", "Perishable items can be returned only if damaged on delivery and reported within 2 hours."),
            ("minimum_order", "Minimum order value is 200 rupees. Delivery is free above 500 rupees."),
            ("freshness", "Vegetables and staples are sourced daily from the local market."),
            ("delivery", "Same-day delivery for orders placed before 2 PM, next-day otherwise."),
        ],
    },
}


# --------------------------------------------------------------------------- #
# Capability templates. `{{...}}` resolves against
# {**collected_inputs, result, context, mock_base} — see PLAN.md section 5.
# --------------------------------------------------------------------------- #
ORDER_INPUT = {
    "name": "order_id",
    "type": "string",
    "prompt": "What's your order number?",
    "default_from": "context.last_order_id",
    "optional": False,
}


def capability(cap_id: str, bid: str) -> dict:
    """Build one capability block for a business."""
    common = {
        "required_inputs": [dict(ORDER_INPUT)],
        "confirm": False,
        "rules": [],
    }

    if cap_id == "track_order":
        return {**common,
            "id": "track_order",
            "description": "Tell the customer where their order currently is and when it will arrive.",
            "examples": [
                "where is my order", "has my order shipped", "track order 1001",
                "मेरा ऑर्डर कहाँ है", "నా ఆర్డర్ ఎక్కడ ఉంది", "என் ஆர்டர் எங்கே இருக்கிறது",
            ],
            "action": "get_order",
            "response": "Your order {{order_id}} — {{result.item}} — is {{result.status}}. Total ₹{{result.amount}}. Expected by {{result.eta}}.",
            "receipt": {"label": "{{result.status}} · arriving {{result.eta}}", "tone": "success"},
        }

    if cap_id == "cancel_order":
        return {**common,
            "id": "cancel_order",
            "description": "Cancel an order that has not yet been delivered.",
            "examples": [
                "cancel my order", "I don't want this order any more",
                "मेरा ऑर्डर कैंसल करो", "నా ఆర్డర్ రద్దు చేయండి", "என் ஆர்டரை ரத்து செய்",
            ],
            "confirm": True,
            "action": "cancel_order",
            "rules": [{
                "id": "already_delivered",
                "when": "result.status == 'delivered'",
                "deny": "Order {{order_id}} has already been delivered, so it can't be cancelled. I can start a return instead.",
            }],
            "response": "Done — order {{order_id}} is cancelled. Any amount paid is refunded within {{result.refund_eta_days}} days.",
            "receipt": {"label": "Cancelled · ref {{result.cancellation_ref}}", "tone": "warning"},
        }

    if cap_id == "request_refund":
        return {**common,
            "id": "request_refund",
            "description": "File a refund for a delivered order the customer is unhappy with.",
            "examples": [
                "I want a refund", "the item is damaged, refund it",
                "मुझे रिफंड चाहिए", "నాకు రీఫండ్ కావాలి", "எனக்கு பணத்தைத் திருப்பி வேண்டும்",
            ],
            "confirm": True,
            "action": "create_refund",
            "rules": [{
                "id": "refund_window",
                "when": "result.days_since_delivery > 7",
                "deny": "Refunds are only available within 7 days of delivery. I can raise a support ticket for you instead.",
            }],
            "response": "Your refund for order {{order_id}} is filed (ref {{result.refund_ref}}). ₹{{result.amount}} reaches your account in {{result.refund_eta_days}} days.",
            "receipt": {"label": "Refund filed · {{result.refund_ref}}", "tone": "success"},
        }

    if cap_id == "request_exchange":
        return {**common,
            "id": "request_exchange",
            "description": "Arrange a size or product exchange for a delivered fashion order.",
            "examples": [
                "I need a different size", "this doesn't fit, exchange it",
                "मुझे दूसरा साइज़ चाहिए", "నాకు వేరే సైజ్ కావాలి", "எனக்கு வேறு அளவு வேண்டும்",
            ],
            "required_inputs": [dict(ORDER_INPUT), {
                "name": "requested_size",
                "type": "string",
                "prompt": "Which size would you like instead?",
                "default_from": None,
                "optional": False,
            }],
            "confirm": True,
            "action": "create_exchange",
            "rules": [{
                "id": "exchange_window",
                "when": "result.days_since_delivery > 7",
                "deny": "Exchanges are only available within 7 days of delivery.",
            }],
            "response": "Exchange booked for order {{order_id}} in size {{requested_size}}. Pickup is scheduled for {{result.pickup_date}}.",
            "receipt": {"label": "Exchange booked · {{result.exchange_ref}}", "tone": "info"},
        }

    if cap_id == "warranty_claim":
        return {**common,
            "id": "warranty_claim",
            "description": "Register a warranty claim for a faulty product and book a service visit.",
            "examples": [
                "my earbuds stopped working", "raise a warranty claim",
                "वारंटी क्लेम करना है", "వారంటీ క్లెయిమ్ చేయాలి", "உத்திரவாதக் கோரிக்கை",
            ],
            "confirm": True,
            "action": "create_warranty_claim",
            "rules": [{
                "id": "warranty_expired",
                "when": "result.days_since_delivery > 365",
                "deny": "This product is past its 1 year warranty period. I can share paid service centre options instead.",
            }],
            "response": "Warranty claim {{result.claim_ref}} is open for order {{order_id}}. A service partner will call you within {{result.callback_hours}} hours.",
            "receipt": {"label": "Claim open · {{result.claim_ref}}", "tone": "info"},
        }

    if cap_id in ("reorder", "reorder_prescription"):
        is_rx = cap_id == "reorder_prescription"
        return {**common,
            "id": cap_id,
            "description": ("Repeat the customer's previous prescription order."
                            if is_rx else "Repeat a previous order for the customer."),
            "examples": [
                "order the same again", "repeat my last order",
                "वही दोबारा भेज दो", "మళ్ళీ అదే పంపండి", "அதே மீண்டும் அனுப்பு",
            ],
            "confirm": True,
            "action": "create_reorder",
            "rules": ([{
                "id": "prescription_required",
                "when": "result.prescription_on_file == false",
                "deny": "I need a valid prescription on file before I can repeat this order. Please upload it and I'll place it right away.",
            }] if is_rx else []),
            "response": "Reordered {{result.item}} for ₹{{result.amount}}. New order {{result.new_order_id}}, arriving {{result.eta}}.",
            "receipt": {"label": "Reordered · {{result.new_order_id}}", "tone": "success"},
        }

    raise ValueError(f"unknown capability {cap_id!r}")


def endpoints_for(bid: str, cap_ids: list[str]) -> list[dict]:
    """One mock-API endpoint per capability action."""
    base = "{{mock_base}}/" + bid
    spec = {
        "get_order":             ("GET",  f"{base}/orders/{{{{order_id}}}}"),
        "cancel_order":          ("POST", f"{base}/orders/{{{{order_id}}}}/cancel"),
        "create_refund":         ("POST", f"{base}/orders/{{{{order_id}}}}/refund"),
        "create_exchange":       ("POST", f"{base}/orders/{{{{order_id}}}}/exchange"),
        "create_warranty_claim": ("POST", f"{base}/orders/{{{{order_id}}}}/warranty"),
        "create_reorder":        ("POST", f"{base}/orders/{{{{order_id}}}}/reorder"),
    }
    actions = {capability(c, bid)["action"] for c in cap_ids}
    out = []
    for action in sorted(actions):
        method, url = spec[action]
        out.append({
            "id": action,
            "method": method,
            "url": url,
            "headers": {},
            "body": None,
            "timeout_s": 5,
        })
    return out


# Capabilities are assembled from a shared base, which leaves the keys in a
# confusing order. Emit them in reading order instead — these files get opened.
CAP_KEY_ORDER = ["id", "description", "examples", "required_inputs", "rules",
                 "confirm", "action", "response", "receipt"]


def ordered_capability(cap_id: str, bid: str) -> dict:
    cap = capability(cap_id, bid)
    assert set(cap) == set(CAP_KEY_ORDER), f"{cap_id}: key drift {set(cap) ^ set(CAP_KEY_ORDER)}"
    return {k: cap[k] for k in CAP_KEY_ORDER}


def build_manifest(bid: str, data: dict) -> dict:
    p = PROFILES[bid]
    caps = p["capabilities"]
    return {
        "ucxp_version": UCXP_VERSION,
        "business": {
            "id": bid,
            "name": data["name"],
            "category": p["category"],
            "glyph": p["glyph"],
            "color": p["color"],
            "languages": LANGUAGES,
        },
        "routing": {"aliases": p["aliases"], "domains": p["domains"]},
        "auth": {"type": "none", "identity_fields": ["order_id"]},
        "capabilities": [ordered_capability(c, bid) for c in caps],
        "endpoints": endpoints_for(bid, caps),
        "knowledge": [{"id": k, "text": v} for k, v in p["knowledge"]],
        "escalation": {
            "when": ["rule_denied", "action_failed", "user_asks_human"],
            "message": "I'm handing this to a human agent from " + data["name"] +
                       " — they'll call you back within 2 hours.",
            "action": "create_escalation_ticket",
        },
    }


def build_seed(bid: str, data: dict) -> dict:
    """Real products + orders, shaped for the mock business API."""
    now = datetime.now(timezone.utc)
    orders, warnings = [], []

    for i, o in enumerate(data["orders"]):
        items = o["items"]
        title = items[0]["title"] if items else "(no items)"
        junk = any(m in title for m in JUNK_MARKERS)
        off_currency = o["currency"] != data["currency"]
        zero = float(o["amount"] or 0) == 0.0

        if junk:
            warnings.append(f"order {o['order_id']}: Shopify sample product ({title}) — do not demo")
        if off_currency:
            warnings.append(f"order {o['order_id']}: currency is {o['currency']}, store is {data['currency']}")
        if zero:
            warnings.append(f"order {o['order_id']}: total is 0.00 — real item but no price")

        delivered = o["status"] == "delivered"
        # eta is synthesised: Shopify carries no delivery estimate on these orders.
        eta = (now + timedelta(days=2 + (i % 3))).strftime("%d %b")
        orders.append({
            "order_id": o["order_id"],
            "item": title,
            "items": items,
            "quantity": sum(i["qty"] for i in items) if items else 0,
            "status": o["status"],
            "status_raw": o["status_raw"],
            "payment": o["payment"],
            "amount": float(o["amount"] or 0),
            "currency": o["currency"],
            "created_at": o["created_at"],
            "eta": "already delivered" if delivered else eta,
            "days_since_delivery": 3 if delivered else 0,
            "prescription_on_file": bid == "sri-pharma",
            "_synthetic_fields": ["eta", "days_since_delivery", "prescription_on_file"],
            "_flags": [f for f, on in
                       (("shopify_sample_data", junk), ("off_currency", off_currency), ("zero_total", zero))
                       if on],
        })

    return {
        "business_id": bid,
        "name": data["name"],
        "currency": data["currency"],
        "shopify_subdomain": data["shopify_subdomain"],
        "source": "Shopify Admin GraphQL API 2026-01 (live)",
        "products": data["products"],
        "orders": orders,
        "_warnings": warnings,
    }


def main() -> None:
    man_dir = HERE / "manifests"
    seed_dir = HERE / "seed"
    man_dir.mkdir(exist_ok=True)
    seed_dir.mkdir(exist_ok=True)

    registry = {}
    for bid, data in REAL.items():
        manifest = build_manifest(bid, data)
        seed = build_seed(bid, data)

        (man_dir / f"{bid}.json").write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n")
        (seed_dir / f"{bid}.json").write_text(json.dumps(seed, indent=2, ensure_ascii=False) + "\n")

        registry[bid] = {
            "name": data["name"],
            "manifest": f"manifests/{bid}.json",
            "seed": f"seed/{bid}.json",
            "capabilities": [c["id"] for c in manifest["capabilities"]],
            "orders": len(seed["orders"]),
            "products": len(seed["products"]),
            "warnings": len(seed["_warnings"]),
        }
        flag = f"  ⚠ {len(seed['_warnings'])} warning(s)" if seed["_warnings"] else ""
        print(f"{bid:20} caps={len(manifest['capabilities'])} "
              f"orders={len(seed['orders']):2} products={len(seed['products']):2}{flag}")

    (HERE / "registry.json").write_text(json.dumps(registry, indent=2) + "\n")
    print(f"\nwrote {len(registry)} manifests + seeds + registry.json")


if __name__ == "__main__":
    main()
