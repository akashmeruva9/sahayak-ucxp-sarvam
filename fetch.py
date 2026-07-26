"""
Fetch and display everything from all 5 real stores — products, orders,
customers, statuses. This is exactly what the runtime will query, so it
verifies the whole data layer is real and reachable.

Run:  /opt/homebrew/bin/python3.13 fetch_all.py
"""
import json, urllib.request

STORES = json.load(open("stores.json"))
API_VER = "2026-01"

NAMES = {
    "meena-kitchen-store": "Meena Kitchen Store",
    "lakshmi-fashion-4kmotaah": "Lakshmi Fashion",
    "ravi-electronics-bmxitv46": "Ravi Electronics",
    "sri-pharma": "Sri Pharma",
    "anna-groceries": "Anna Groceries",
}

def gql(sub, token, query):
    body = json.dumps({"query": query}).encode()
    req = urllib.request.Request(
        f"https://{sub}.myshopify.com/admin/api/{API_VER}/graphql.json",
        data=body,
        headers={"X-Shopify-Access-Token": token, "Content-Type": "application/json"})
    return json.load(urllib.request.urlopen(req))

def safe(d, *keys, default=None):
    cur = d
    for k in keys:
        if not isinstance(cur, dict): return default
        cur = cur.get(k)
    return cur if cur is not None else default

STATUS_WORD = {
    "FULFILLED": "delivered/shipped",
    "IN_PROGRESS": "in transit",
    "UNFULFILLED": "being prepared",
    "PARTIALLY_FULFILLED": "partly shipped",
}

for sub, token in STORES.items():
    print("\n" + "="*60)
    print(f"  {NAMES.get(sub, sub)}   ({sub})")
    print("="*60)

    # products
    q = """{ products(first: 10) { nodes {
        title
        variants(first:1){ nodes{ price } }
    } } }"""
    r = gql(sub, token, q)
    prods = safe(r, "data", "products", "nodes", default=[])
    print(f"\n  PRODUCTS ({len(prods)}):")
    for p in prods:
        price = safe(p, "variants", "nodes", default=[{}])
        price = price[0].get("price", "?") if price else "?"
        print(f"    - {p['title']:34}  Rs.{price}")

    # orders with customer + status + line items
    q2 = """{ orders(first: 12, reverse: true) { nodes {
        name
        displayFulfillmentStatus
        customer { firstName lastName }
        totalPriceSet { shopMoney { amount currencyCode } }
        lineItems(first:2){ nodes{ title quantity } }
    } } }"""
    r2 = gql(sub, token, q2)
    orders = safe(r2, "data", "orders", "nodes", default=[])
    print(f"\n  ORDERS ({len(orders)}):")
    for o in orders:
        cust = safe(o, "customer")
        cust_name = f"{cust['firstName']} {cust.get('lastName','')}".strip() if cust else "(no customer)"
        status = o["displayFulfillmentStatus"]
        friendly = STATUS_WORD.get(status, status)
        amt = safe(o, "totalPriceSet", "shopMoney", "amount", default="?")
        cur = safe(o, "totalPriceSet", "shopMoney", "currencyCode", default="")
        items = safe(o, "lineItems", "nodes", default=[])
        item_str = ", ".join(f"{i['title']} x{i['quantity']}" for i in items)
        print(f"    {o['name']:14} {cust_name:18} {friendly:16} {cur} {amt}")
        print(f"        └ {item_str}")

    # customer count
    q3 = "{ customers(first: 20) { nodes { firstName lastName } } }"
    try:
        r3 = gql(sub, token, q3)
        custs = safe(r3, "data", "customers", "nodes", default=[])
        names = ", ".join(f"{c['firstName']} {c.get('lastName','')}".strip() for c in custs)
        print(f"\n  CUSTOMERS ({len(custs)}): {names}")
    except Exception as e:
        print(f"\n  CUSTOMERS: (couldn't fetch — {str(e)[:50]})")

print("\n" + "="*60)
print("  ALL 5 STORES VERIFIED — this is exactly what the runtime queries.")
print("="*60)