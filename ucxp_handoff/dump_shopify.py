"""Dump real products + orders from all 5 Shopify stores to JSON.

Read-only. Never writes tokens into the output.
"""
import json, urllib.request, pathlib, sys

ROOT = pathlib.Path("/Users/manideepkaralapati/Desktop/sarvam")
STORES = json.load(open(ROOT / "stores.json"))
API_VER = "2026-01"

NAMES = {
    "meena-kitchen-store":       ("meena-kitchen",     "Meena Kitchen Store"),
    "lakshmi-fashion-4kmotaah":  ("lakshmi-fashion",   "Lakshmi Fashion"),
    "ravi-electronics-bmxitv46": ("ravi-electronics",  "Ravi Electronics"),
    "sri-pharma":                ("sri-pharma",        "Sri Pharma"),
    "anna-groceries":            ("anna-groceries",    "Anna Groceries"),
}

STATUS_WORD = {
    "FULFILLED": "delivered",
    "IN_PROGRESS": "in transit",
    "UNFULFILLED": "being prepared",
    "PARTIALLY_FULFILLED": "partly shipped",
}


def gql(sub, token, query):
    req = urllib.request.Request(
        f"https://{sub}.myshopify.com/admin/api/{API_VER}/graphql.json",
        data=json.dumps({"query": query}).encode(),
        headers={"X-Shopify-Access-Token": token, "Content-Type": "application/json"})
    return json.load(urllib.request.urlopen(req))


def safe(d, *keys, default=None):
    cur = d
    for k in keys:
        if not isinstance(cur, dict):
            return default
        cur = cur.get(k)
    return cur if cur is not None else default


out = {}
for sub, token in STORES.items():
    bid, display = NAMES[sub]
    shop = gql(sub, token, "{ shop { name currencyCode } }")

    p = gql(sub, token, """{ products(first: 20) { nodes {
        title handle productType
        variants(first:1){ nodes{ price sku inventoryQuantity } }
    } } }""")
    products = []
    for n in safe(p, "data", "products", "nodes", default=[]):
        v = (safe(n, "variants", "nodes", default=[{}]) or [{}])[0]
        products.append({
            "title": n["title"],
            "handle": n.get("handle"),
            "type": n.get("productType") or "",
            "price": v.get("price"),
            "sku": v.get("sku") or "",
            "stock": v.get("inventoryQuantity"),
        })

    o = gql(sub, token, """{ orders(first: 25, reverse: true) { nodes {
        name createdAt displayFulfillmentStatus displayFinancialStatus
        totalPriceSet { shopMoney { amount currencyCode } }
        lineItems(first:5){ nodes{ title quantity } }
    } } }""")
    orders = []
    for n in safe(o, "data", "orders", "nodes", default=[]):
        raw = n["displayFulfillmentStatus"]
        orders.append({
            "order_id": n["name"].lstrip("#"),
            "created_at": n.get("createdAt"),
            "status_raw": raw,
            "status": STATUS_WORD.get(raw, raw.lower()),
            "payment": n.get("displayFinancialStatus"),
            "amount": safe(n, "totalPriceSet", "shopMoney", "amount"),
            "currency": safe(n, "totalPriceSet", "shopMoney", "currencyCode"),
            "items": [{"title": i["title"], "qty": i["quantity"]}
                      for i in safe(n, "lineItems", "nodes", default=[])],
        })

    out[bid] = {
        "business_id": bid,
        "name": display,
        "shop_name": safe(shop, "data", "shop", "name"),
        "currency": safe(shop, "data", "shop", "currencyCode"),
        "shopify_subdomain": sub,
        "products": products,
        "orders": orders,
    }
    print(f"{bid:20} products={len(products):2} orders={len(orders):2}", file=sys.stderr)

dest = pathlib.Path(__file__).parent / "real_data.json"
dest.write_text(json.dumps(out, indent=2))
print(f"\nwrote {dest}", file=sys.stderr)
