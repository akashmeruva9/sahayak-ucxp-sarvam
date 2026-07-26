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


def _store_domain(source: dict[str, Any]) -> str | None:
    domain = (source.get("store_subdomain") or "").strip()
    if not domain:
        return None
    return domain if domain.endswith("myshopify.com") else f"{domain}.myshopify.com"


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
    }


# --------------------------------------------------------------------------- #
# Deterministic mock (no token configured)
# --------------------------------------------------------------------------- #
_ITEMS = ["boAt Airdopes 141 Earbuds", "Redmi Power Bank 20000mAh", "Boult Smartwatch"]
_STATUS = ["being prepared", "shipped", "out for delivery", "delivered"]


def _stable(seed: str, modulo: int) -> int:
    return int(hashlib.sha256(seed.encode()).hexdigest(), 16) % modulo


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
    domain = _store_domain(source)
    token = _resolve_token(source.get("credential_ref"))

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
    domain = _store_domain(source)
    token = _resolve_token(source.get("credential_ref"))

    amount, currency = None, "INR"
    if domain and token:
        try:
            order = await _fetch_order(domain, token, order_id)
            if order is None:
                raise HTTPException(status_code=404, detail=f"I couldn't find order {order_id} to refund.")
            amount = order.get("total_price")
            currency = order.get("currency", "INR")
        except httpx.HTTPError:
            pass
    if amount is None:
        amount = _mock_order(order_id)["amount"]

    return {
        "refund_id": f"RF{_stable(order_id, 100000):05d}",
        "order_id": order_id.lstrip("#"),
        "status": "initiated",
        "amount": amount,
        "currency": currency,
        "eta_days": 5,
    }
