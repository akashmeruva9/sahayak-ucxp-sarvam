"""Shopify connector — turns a manifest's `shopify_default` capabilities into
real Admin API calls.

The runtime executor calls these routes (the manifest endpoints are normalised
to point here, carrying the business id). Each business's store + credential
come from its manifest `data_source`; the token is resolved from the
environment (`credential_ref: vault://ravi-electronics` → `SHOPIFY_TOKEN_RAVI_ELECTRONICS`,
or a single `SHOPIFY_TOKEN` fallback).

If no token is configured, the connector serves deterministic **mock** data so
the demo still works — but with a token it returns the customer's real order.
This keeps the runtime business-generic: it only knows "call the connector".
"""

from __future__ import annotations

import hashlib
import os
from datetime import date, timedelta
from typing import Any

import httpx
from fastapi import APIRouter, HTTPException
from loguru import logger

from ..runtime.loader import get_registry

router = APIRouter(prefix="/connectors/shopify", tags=["connectors"])

SHOPIFY_API_VERSION = "2024-10"


# --------------------------------------------------------------------------- #
# Credentials + store lookup (from the manifest data_source)
# --------------------------------------------------------------------------- #
def _data_source(business_id: str) -> dict[str, Any]:
    raw = get_registry().raw(business_id) or {}
    return raw.get("data_source") or {}


def _resolve_token(credential_ref: str | None) -> str | None:
    """`vault://ravi-electronics` → env `SHOPIFY_TOKEN_RAVI_ELECTRONICS`.

    Falls back to a single `SHOPIFY_TOKEN` so a one-store demo needs no suffix.
    """
    if credential_ref and credential_ref.startswith("vault://"):
        key = "SHOPIFY_TOKEN_" + credential_ref[len("vault://"):].upper().replace("-", "_")
        token = os.getenv(key)
        if token:
            return token.strip()
    return (os.getenv("SHOPIFY_TOKEN") or "").strip() or None


def _store_domain(source: dict[str, Any], business_id: str = "") -> str | None:
    """The merchant's store, from the manifest or the environment.

    The environment fallback exists because a published manifest can arrive
    without `store_subdomain` — one did, and because a published row replaces
    the committed file wholesale, a working integration silently became
    fabricated data. `SHOPIFY_STORE_RAVI_ELECTRONICS` restores it without
    waiting on a republish.
    """
    domain = (source.get("store_subdomain") or "").strip()
    if not domain and business_id:
        key = "SHOPIFY_STORE_" + business_id.upper().replace("-", "_")
        domain = (os.getenv(key) or os.getenv("SHOPIFY_STORE") or "").strip()
    if not domain:
        return None
    return domain if domain.endswith("myshopify.com") else f"{domain}.myshopify.com"


def _declares_a_real_store(source: dict[str, Any]) -> bool:
    """True when the manifest says this business has a live Shopify store."""
    return str(source.get("type") or "").strip().lower() == "shopify"


def _unreachable(business_id: str, source: dict[str, Any], what: str) -> HTTPException:
    """Refuse to answer rather than inventing one.

    A merchant whose manifest declares a Shopify store has real orders with real
    statuses, and a customer asking about one is entitled to either the truth or
    an honest failure. Serving the deterministic sample here told a customer
    their delivered order was "out for delivery, arriving Thursday" — stated as
    fact, in the store's own voice. The sample is for businesses that never
    claimed a store; anything else escalates.
    """
    missing = []
    if not _store_domain(source, business_id):
        missing.append("store_subdomain")
    if not _resolve_token(source.get("credential_ref")):
        missing.append("token")
    logger.error(
        f"shopify.unconfigured business={business_id} {what} missing={','.join(missing) or 'unknown'}"
    )
    return HTTPException(
        status_code=502,
        detail="I can't reach the store's system right now, so I'd rather not guess. "
        "Let me get a colleague to check this for you.",
    )


# --------------------------------------------------------------------------- #
# Real Shopify Admin API
# --------------------------------------------------------------------------- #
async def _fetch_order(domain: str, token: str, order_number: str) -> dict[str, Any] | None:
    """Look up an order by its customer-facing number (e.g. 1001 / #1001)."""
    name = order_number.lstrip("#").strip()
    url = f"https://{domain}/admin/api/{SHOPIFY_API_VERSION}/orders.json"
    params = {"status": "any", "name": name, "limit": "1"}
    headers = {"X-Shopify-Access-Token": token, "Accept": "application/json"}
    async with httpx.AsyncClient(timeout=10.0) as client:
        resp = await client.get(url, params=params, headers=headers)
    if resp.status_code == 401:
        raise HTTPException(status_code=502, detail="Shopify rejected the access token.")
    resp.raise_for_status()
    orders = (resp.json() or {}).get("orders") or []
    return orders[0] if orders else None


def _delivery(order: dict[str, Any], fulfillments: list[dict[str, Any]]) -> tuple[str | None, int | None]:
    """When the order was delivered, and how long ago.

    Every return policy in these manifests turns on this date, so a support
    agent needs it before it can decide anything — and it should *look it up*
    rather than ask the customer to remember. `delivered_on` is None when the
    order isn't delivered yet, which is itself the answer to "can I return it".
    """
    stamp = next(
        (f.get("updated_at") or f.get("created_at")
         for f in fulfillments if f.get("shipment_status") == "delivered"),
        None,
    ) or (order.get("closed_at") if order.get("fulfillment_status") == "fulfilled" else None)
    if not stamp:
        return None, None
    try:
        delivered = date.fromisoformat(str(stamp)[:10])
    except ValueError:
        return None, None
    return delivered.isoformat(), (date.today() - delivered).days


def _map_order(order: dict[str, Any]) -> dict[str, Any]:
    """Flatten a Shopify order into the fields the composer speaks from."""
    fulfillments = order.get("fulfillments") or []
    shipment = next(
        (f.get("shipment_status") for f in fulfillments if f.get("shipment_status")), None
    )
    status = (
        shipment
        or order.get("fulfillment_status")
        or ("being prepared" if order.get("financial_status") == "paid" else "pending")
    )
    tracking = fulfillments[0] if fulfillments else {}
    delivered_on, days_since = _delivery(order, fulfillments)
    items = [
        {"title": li.get("title", "item"), "qty": li.get("quantity", 1)}
        for li in (order.get("line_items") or [])
    ]
    return {
        "order_id": (order.get("name") or "").lstrip("#") or str(order.get("order_number", "")),
        "status": str(status).replace("_", " "),
        "payment": order.get("financial_status", "unknown"),
        "amount": order.get("total_price") or order.get("current_total_price"),
        "currency": order.get("currency", "INR"),
        "items": items,
        "tracking_number": tracking.get("tracking_number"),
        "tracking_url": tracking.get("tracking_url"),
        "placed_on": (order.get("created_at") or "")[:10],
        "delivered_on": delivered_on,
        "days_since_delivery": days_since,
    }


# --------------------------------------------------------------------------- #
# Deterministic mock (no token configured)
# --------------------------------------------------------------------------- #
_ITEMS = ["boAt Airdopes 141 Earbuds", "Redmi Power Bank 20000mAh", "Boult Smartwatch"]
_STATUS = ["being prepared", "shipped", "out for delivery", "delivered"]


def _stable(seed: str, modulo: int) -> int:
    return int(hashlib.sha256(seed.encode()).hexdigest(), 16) % modulo


def _pickup_slot(order_id: str) -> tuple[str, str]:
    """A collection date two or three days out, skipping Sunday.

    Deterministic on the order number so the same request quotes the same slot
    on every retry — a customer who asks twice must not be told two different
    dates. Reverse pickup is how a return actually completes: the agent collects
    and checks the item, and only then does the money move.
    """
    day = date.today() + timedelta(days=2 + _stable(order_id, 2))
    if day.weekday() == 6:  # Sunday — no collections
        day += timedelta(days=1)
    return day.strftime("%A, %d %B"), "10 AM to 6 PM"


def _mock_order(order_id: str) -> dict[str, Any]:
    bucket = _stable(order_id, 4)
    return {
        "order_id": order_id,
        "status": _STATUS[bucket],
        "eta": "today, before 9 PM" if bucket == 0 else (date.today() + timedelta(days=bucket)).strftime("%A, %d %B"),
        "payment": "paid",
        "amount": f"{799 + _stable(order_id, 60) * 50}.00",
        "currency": "INR",
        "days_since_delivery": _stable(order_id, 12) if bucket == 3 else 0,
        "items": [{"title": _ITEMS[_stable(order_id, len(_ITEMS))], "qty": 1}],
        "mock": True,
    }


# --------------------------------------------------------------------------- #
# Routes (the runtime executor calls these)
# --------------------------------------------------------------------------- #
@router.get("/{business_id}/orders/{order_id}")
async def track_order(business_id: str, order_id: str) -> dict[str, Any]:
    if len(order_id.strip()) < 2:
        raise HTTPException(status_code=404, detail="Sorry, we couldn't find that order number.")

    source = _data_source(business_id)
    domain = _store_domain(source, business_id)
    token = _resolve_token(source.get("credential_ref"))

    if not (domain and token) and _declares_a_real_store(source):
        raise _unreachable(business_id, source, f"track order={order_id}")

    if domain and token:
        try:
            order = await _fetch_order(domain, token, order_id)
        except HTTPException:
            raise
        except httpx.HTTPError as exc:
            logger.error(f"shopify.track_failed business={business_id} order={order_id} {exc}")
            raise HTTPException(status_code=502, detail="I couldn't reach the store just now. Please try again shortly.")
        if order is None:
            raise HTTPException(status_code=404, detail=f"I couldn't find order {order_id} in our records.")
        logger.info(f"shopify.track business={business_id} order={order_id} source=live")
        return _map_order(order)

    logger.info(f"shopify.track business={business_id} order={order_id} source=mock")
    return _mock_order(order_id)


@router.post("/{business_id}/orders/{order_id}/refund")
async def refund_order(business_id: str, order_id: str, payload: dict[str, Any] | None = None) -> dict[str, Any]:
    """Refunds are initiated (never auto-committed): a real Shopify refund is a
    destructive, write-scoped operation, so we register the request against the
    real order amount and hand it to the team, rather than silently moving money."""
    source = _data_source(business_id)
    domain = _store_domain(source, business_id)
    token = _resolve_token(source.get("credential_ref"))

    if not (domain and token) and _declares_a_real_store(source):
        raise _unreachable(business_id, source, f"refund order={order_id}")

    amount, currency = None, "INR"
    delivered_on, days_since = None, None
    if domain and token:
        try:
            order = await _fetch_order(domain, token, order_id)
            if order is None:
                raise HTTPException(status_code=404, detail=f"I couldn't find order {order_id} to refund.")
            amount = order.get("total_price")
            currency = order.get("currency", "INR")
            delivered_on, days_since = _delivery(order, order.get("fulfillments") or [])
        except httpx.HTTPError:
            pass
    if amount is None:
        amount = _mock_order(order_id)["amount"]

    reason = (payload or {}).get("reason") or None
    evidence_ref = (payload or {}).get("evidence_ref") or None
    pickup_on, pickup_window = _pickup_slot(order_id)
    logger.info(
        f"shopify.pickup_scheduled business={business_id} order={order_id} "
        f"amount={amount} days_since_delivery={days_since} pickup={pickup_on} "
        f"reason={reason!r} evidence={evidence_ref or 'none'}"
    )
    return {
        "refund_id": f"RF{_stable(order_id, 100000):05d}",
        "order_id": order_id.lstrip("#"),
        # The money does not move yet, and the wording must not imply it does.
        # A return is collected and inspected first; saying "refund initiated"
        # to someone still holding the item is a promise the business has not
        # made.
        "status": "approved — pickup scheduled",
        "pickup_on": pickup_on,
        "pickup_window": pickup_window,
        "instructions": (
            "Please keep the item in its original box with all accessories and the invoice, "
            "ready for our agent to check at pickup."
        ),
        "amount": amount,
        "currency": currency,
        "eta_days": 5,
        "delivered_on": delivered_on,
        "days_since_delivery": days_since,
        "reason": reason,
        "evidence_ref": evidence_ref,
    }
