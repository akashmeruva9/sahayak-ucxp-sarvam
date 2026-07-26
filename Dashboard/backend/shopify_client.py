"""Read-only Shopify Admin GraphQL client.

Ported from ucxp_handoff/dump_shopify.py -- same API version, same endpoint shape,
same auth header, same queries, same safe()/STATUS_WORD helpers. Three things are
added that the original lacked and that a web backend cannot go without:

  * a request timeout (the originals inherit the unbounded socket default),
  * a retry loop that rebuilds the Request each attempt (reusing one Request
    object across attempts, as the seed scripts do, is unreliable with a body),
  * cursor pagination, so a store that grows past one page is not silently
    truncated.

DELIBERATE OMISSION: the orders query requests no customer fields. The Shopify
Basic plan blocks customer PII anyway, and the whole product identifies customers
by order number. Do not add `customer { ... }` back -- tests/backend/test_backend.py
gate B3 fails the build if any query string mentions it.
"""

import json
import time
import urllib.error
import urllib.request

API_VER = "2026-01"
TIMEOUT_SECONDS = 10
MAX_ATTEMPTS = 3

# Customer-facing wording for Shopify's fulfillment enum (from dump_shopify.py).
STATUS_WORD = {
    "FULFILLED": "delivered",
    "IN_PROGRESS": "in transit",
    "UNFULFILLED": "being prepared",
    "PARTIALLY_FULFILLED": "partly shipped",
}

SHOP_QUERY = "{ shop { name currencyCode } }"

PRODUCTS_QUERY = """query($cursor: String) {
  products(first: 50, after: $cursor) {
    pageInfo { hasNextPage endCursor }
    nodes {
      title handle productType
      variants(first:1){ nodes{ price sku inventoryQuantity } }
    }
  }
}"""

ORDERS_QUERY = """query($cursor: String) {
  orders(first: 50, after: $cursor, reverse: true) {
    pageInfo { hasNextPage endCursor }
    nodes {
      name createdAt displayFulfillmentStatus displayFinancialStatus
      totalPriceSet { shopMoney { amount currencyCode } }
      lineItems(first:5){ nodes{ title quantity } }
    }
  }
}"""

# Every GraphQL document this module can send. Gate B3 scans exactly this list.
ALL_QUERIES = [SHOP_QUERY, PRODUCTS_QUERY, ORDERS_QUERY]


class ShopifyError(Exception):
    """A friendly, already-safe-to-show message. Never carries a token."""


def safe(d, *keys, default=None):
    """Nested-dict walker from dump_shopify.py -- returns default on any miss."""
    cur = d
    for k in keys:
        if not isinstance(cur, dict):
            return default
        cur = cur.get(k)
    return cur if cur is not None else default


def _endpoint(subdomain):
    return "https://{}.myshopify.com/admin/api/{}/graphql.json".format(subdomain, API_VER)


def gql(subdomain, token, query, variables=None):
    """POST one GraphQL document. Retries transient failures, never leaks the token."""
    payload = json.dumps({"query": query, "variables": variables or {}}).encode()
    last_error = None

    for attempt in range(1, MAX_ATTEMPTS + 1):
        # Rebuild the Request every attempt -- reusing one with a body is fragile.
        request = urllib.request.Request(
            _endpoint(subdomain),
            data=payload,
            headers={"X-Shopify-Access-Token": token,
                     "Content-Type": "application/json"},
        )
        try:
            with urllib.request.urlopen(request, timeout=TIMEOUT_SECONDS) as response:
                body = json.load(response)
            if body.get("errors"):
                messages = [e.get("message", "") for e in body["errors"]]
                raise ShopifyError("Shopify rejected the request: {}".format(
                    "; ".join(m for m in messages if m) or "unknown error"))
            return body
        except urllib.error.HTTPError as exc:
            if exc.code in (401, 403):
                raise ShopifyError(
                    "Shopify refused that access token. Check the token and that it "
                    "has read_orders and read_products scopes.")
            if exc.code == 404:
                raise ShopifyError(
                    "No Shopify store found at that subdomain. Check the spelling.")
            last_error = ShopifyError(
                "Shopify returned an error (HTTP {}). Please try again.".format(exc.code))
        except urllib.error.URLError as exc:
            last_error = ShopifyError(
                "Couldn't reach Shopify ({}). Check your connection and try again."
                .format(getattr(exc, "reason", "network error")))
        except ShopifyError:
            raise
        except (ValueError, TypeError):
            last_error = ShopifyError("Shopify sent a response we couldn't read.")

        if attempt < MAX_ATTEMPTS:
            time.sleep(1.5 * attempt)

    raise last_error or ShopifyError("Shopify is not responding. Please try again.")


def _paginate(subdomain, token, query, root, limit=250):
    """Follow endCursor until exhausted or `limit` nodes collected."""
    nodes = []
    cursor = None
    while True:
        body = gql(subdomain, token, query, {"cursor": cursor})
        page = safe(body, "data", root, default={}) or {}
        nodes.extend(page.get("nodes") or [])
        info = page.get("pageInfo") or {}
        if not info.get("hasNextPage") or len(nodes) >= limit:
            break
        cursor = info.get("endCursor")
        if not cursor:
            break
    return nodes[:limit]


def fetch_shop(subdomain, token):
    """{'name', 'currency'} for the store. Raises ShopifyError on a bad token."""
    body = gql(subdomain, token, SHOP_QUERY)
    return {
        "name": safe(body, "data", "shop", "name", default=""),
        "currency": safe(body, "data", "shop", "currencyCode", default=""),
    }


def fetch_products(subdomain, token, limit=250):
    """Product list. Field extraction identical to dump_shopify.py."""
    products = []
    for n in _paginate(subdomain, token, PRODUCTS_QUERY, "products", limit):
        variant = (safe(n, "variants", "nodes", default=[{}]) or [{}])[0]
        products.append({
            "title": n.get("title") or "",
            "handle": n.get("handle"),
            "type": n.get("productType") or "",
            "price": variant.get("price"),
            "sku": variant.get("sku") or "",
            "stock": variant.get("inventoryQuantity"),
        })
    return products


def fetch_orders(subdomain, token, limit=250):
    """Order list keyed by order NUMBER -- the only customer identifier we use.

    Note the order number is not unique across stores (1001 exists in four of the
    five seeded stores), so callers must key on (business_id, order_id).
    """
    orders = []
    for n in _paginate(subdomain, token, ORDERS_QUERY, "orders", limit):
        raw = n.get("displayFulfillmentStatus") or ""
        orders.append({
            "order_id": (n.get("name") or "").lstrip("#"),
            "created_at": n.get("createdAt"),
            "status_raw": raw,
            "status": STATUS_WORD.get(raw, raw.lower()),
            "payment": n.get("displayFinancialStatus"),
            "amount": safe(n, "totalPriceSet", "shopMoney", "amount"),
            "currency": safe(n, "totalPriceSet", "shopMoney", "currencyCode"),
            "items": [{"title": i.get("title") or "", "qty": i.get("quantity")}
                      for i in safe(n, "lineItems", "nodes", default=[])],
        })
    return orders


def verify_connection(subdomain, token):
    """One call used by POST /api/connect/shopify.

    Returns {'ok': True, 'shop_name', 'currency', 'product_count', 'order_count'}
    or raises ShopifyError with a message that is already safe to show a merchant.
    """
    subdomain = (subdomain or "").strip().lower()
    # Accept a pasted full domain as well as a bare subdomain.
    for suffix in (".myshopify.com/", ".myshopify.com"):
        if subdomain.endswith(suffix):
            subdomain = subdomain[: -len(suffix)]
    subdomain = subdomain.replace("https://", "").replace("http://", "").strip("/")

    if not subdomain:
        raise ShopifyError("Enter your store subdomain, e.g. ravi-electronics-bmxitv46.")
    if not (token or "").strip():
        raise ShopifyError("A Shopify Admin API access token is required.")

    shop = fetch_shop(subdomain, token)
    products = fetch_products(subdomain, token)
    orders = fetch_orders(subdomain, token)
    return {
        "ok": True,
        "subdomain": subdomain,
        "shop_name": shop["name"],
        "currency": shop["currency"] or (orders[0]["currency"] if orders else ""),
        "product_count": len(products),
        "order_count": len(orders),
    }
