"""Seed a fresh Shopify store with an Andhra pickle catalogue and some orders.

Written for testing the "any merchant can connect" path end to end: a store the
dashboard has never heard of, with real products and real orders behind it.

    export SHOPIFY_SEED_STORE=deepika-andhra-pickles-48kcwllj
    export SHOPIFY_SEED_TOKEN=shpat_...
    ./venv/bin/python seed_pickles.py

The token needs write_products, write_customers and write_orders. Read-only
scopes are enough for the dashboard itself but cannot create anything.

Safe to re-run: products are matched by title and orders by the note attribute,
so a second run tops up what is missing rather than duplicating the catalogue.
"""

import json
import os
import sys
import time
import urllib.error
import urllib.request

API_VERSION = "2026-01"
SEED_TAG = "sahayak-seed"

STORE = (os.environ.get("SHOPIFY_SEED_STORE") or "").strip().replace(".myshopify.com", "")
TOKEN = (os.environ.get("SHOPIFY_SEED_TOKEN") or "").strip().strip("'\"")

PRODUCTS = [
    {
        "title": "Avakaya Mango Pickle",
        "body": "The Andhra classic. Raw mango, mustard, garlic and cold-pressed "
                "sesame oil, cured the way it is done at home. Fiery, and it keeps "
                "for a year.",
        "type": "Pickle",
        "vendor": "Deepika Andhra Pickles",
        "tags": ["pickle", "mango", "andhra", "hot"],
        "variants": [
            {"option1": "250 g", "price": "249.00", "sku": "AVK-250", "grams": 250},
            {"option1": "500 g", "price": "449.00", "sku": "AVK-500", "grams": 500},
        ],
    },
    {
        "title": "Gongura Pickle",
        "body": "Sorrel leaves slow-cooked with red chilli and garlic. Tangy rather "
                "than sharp, and the one people ask for by name.",
        "type": "Pickle",
        "vendor": "Deepika Andhra Pickles",
        "tags": ["pickle", "gongura", "andhra"],
        "variants": [
            {"option1": "250 g", "price": "279.00", "sku": "GON-250", "grams": 250},
            {"option1": "500 g", "price": "499.00", "sku": "GON-500", "grams": 500},
        ],
    },
]

CUSTOMERS = [
    ("Sridevi", "Rao", "sridevi.rao@example.in", "+919812340101",
     "12-3-45 Dwarakanagar", "Visakhapatnam", "530016"),
    ("Naveen", "Chowdary", "naveen.chowdary@example.in", "+919812340102",
     "8-2-120 Banjara Hills", "Hyderabad", "500034"),
    ("Padmaja", "Reddy", "padmaja.reddy@example.in", "+919812340103",
     "4-7-19 Governorpet", "Vijayawada", "520002"),
]


class DuplicateEmail(Exception):
    """A customer with this email is already in the store."""


def _call(path, payload=None, method="GET"):
    """One Admin REST call. Raises with Shopify's own message, which is specific."""
    url = "https://{}.myshopify.com/admin/api/{}/{}".format(STORE, API_VERSION, path)
    data = json.dumps(payload).encode() if payload is not None else None
    request = urllib.request.Request(url, data=data, method=method, headers={
        "X-Shopify-Access-Token": TOKEN,
        "Content-Type": "application/json",
        "Accept": "application/json",
    })
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return json.loads(response.read() or "{}")
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", "replace")[:400]
        if exc.code == 422 and "has already been taken" in body:
            raise DuplicateEmail(body)
        raise SystemExit(
            "\n  Shopify said {} on {} {}\n  {}\n\n"
            "  403 usually means the app is missing a write scope.\n"
            "  404 usually means the store subdomain is wrong.\n"
            "  401 means the token is wrong or the app was never installed.\n"
            .format(exc.code, method, path, body))


def ensure_products():
    existing = {p["title"]: p for p in _call("products.json?limit=250").get("products", [])}
    out = {}
    for spec in PRODUCTS:
        found = existing.get(spec["title"])
        if found:
            print("  = {} already there".format(spec["title"]))
            out[spec["title"]] = found
            continue
        created = _call("products.json", {"product": {
            "title": spec["title"],
            "body_html": "<p>{}</p>".format(spec["body"]),
            "product_type": spec["type"],
            "vendor": spec["vendor"],
            "tags": ",".join(spec["tags"] + [SEED_TAG]),
            "status": "active",
            "options": [{"name": "Size"}],
            "variants": [dict(v, inventory_management=None) for v in spec["variants"]],
        }}, method="POST")["product"]
        print("  + {} ({} variants)".format(created["title"], len(created["variants"])))
        out[spec["title"]] = created
        time.sleep(0.6)          # Shopify's REST bucket refills at 2/s
    return out


def ensure_customers():
    """Create the customers, tolerating ones that already exist.

    Listing customers is deliberately not used to decide this. Shopify gates
    customer PII behind protected-data approval, so GET customers.json comes
    back empty rather than erroring -- which reads as "none exist" and sends
    this straight into a duplicate-email 422 on every re-run. Treating that 422
    as success is the honest check.

    Orders are attached by email rather than customer id for the same reason:
    the id cannot be read back, and Shopify links the order to the existing
    customer record from the email anyway.
    """
    out = []
    for first, last, email, phone, address, city, zipcode in CUSTOMERS:
        record = {"first": first, "last": last, "email": email, "phone": phone,
                  "address1": address, "city": city, "zip": zipcode}
        try:
            _call("customers.json", {"customer": {
                "first_name": first, "last_name": last, "email": email, "phone": phone,
                "tags": SEED_TAG,
                "addresses": [{
                    "address1": address, "city": city, "province": "Andhra Pradesh",
                    "country": "India", "zip": zipcode, "phone": phone,
                    "first_name": first, "last_name": last,
                }],
            }}, method="POST")
            print("  + {} {}".format(first, last))
            time.sleep(0.6)
        except DuplicateEmail:
            print("  = {} {} already there".format(first, last))
        out.append(record)
    return out


def ensure_orders(products, customers):
    """One order per customer, so track_order has something real to look up."""
    already = len([o for o in _call("orders.json?status=any&limit=250").get("orders", [])
                   if SEED_TAG in (o.get("tags") or "")])
    if already >= len(customers):
        print("  = {} seeded orders already there".format(already))
        return

    picks = [
        (products["Avakaya Mango Pickle"], 0, 2),
        (products["Gongura Pickle"], 1, 1),
        (products["Avakaya Mango Pickle"], 1, 1),
    ]
    for customer, (product, variant_index, quantity) in zip(customers, picks):
        variant = product["variants"][variant_index]
        order = _call("orders.json", {"order": {
            "email": customer["email"],
            "phone": customer["phone"],
            "line_items": [{"variant_id": variant["id"], "quantity": quantity}],
            "financial_status": "paid",
            "currency": "INR",
            "tags": SEED_TAG,
            "shipping_address": {
                "address1": customer["address1"], "city": customer["city"],
                "province": "Andhra Pradesh", "country": "India",
                "zip": customer["zip"],
                "first_name": customer["first"], "last_name": customer["last"],
            },
        }}, method="POST")["order"]
        print("  + order #{}  {} x{}  {} {}".format(
            order["order_number"], product["title"], quantity,
            order["currency"], order["total_price"]))
        time.sleep(0.6)


def main():
    if not STORE or not TOKEN:
        raise SystemExit(
            "\n  Set both first:\n"
            "    export SHOPIFY_SEED_STORE=your-store-subdomain\n"
            "    export SHOPIFY_SEED_TOKEN=shpat_...\n")

    shop = _call("shop.json")["shop"]
    print("\nStore: {}  ({})\n".format(shop["name"], shop.get("currency")))

    print("Products")
    products = ensure_products()
    print("\nCustomers")
    customers = ensure_customers()
    print("\nOrders")
    ensure_orders(products, customers)

    counts = _call("products/count.json")["count"], _call("orders/count.json?status=any")["count"]
    print("\nDone. {} products, {} orders.\n".format(*counts))
    print("Now connect it in the dashboard:")
    print("  subdomain : {}".format(STORE))
    print("  token     : the same one you just used\n")


if __name__ == "__main__":
    sys.exit(main())
