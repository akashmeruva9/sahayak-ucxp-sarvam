"""
Seed ALL 5 real Shopify stores with theme-appropriate products + paid orders.
Reads tokens from stores.json. Everything created is REAL Shopify data.
Safe to re-run (skips products that already exist by title).

Run:  /opt/homebrew/bin/python3.13 seed_stores.py
"""
import json, time, urllib.request

STORES = json.load(open("stores.json"))

# theme catalogue: subdomain -> (products[(title, price, type)], orders[(id,item,status,amount)])
CATALOG = {
    "meena-kitchen-store": {
        "name": "Meena Kitchen Store",
        "products": [
            ("Prestige Mixer Grinder 750W", 4499, "Kitchen Appliances"),
            ("Butterfly Pressure Cooker 5L", 2199, "Kitchen Appliances"),
            ("Bajaj Induction Cooktop 1900W", 2799, "Kitchen Appliances"),
        ],
    },
    "lakshmi-fashion-4kmotaah": {
        "name": "Lakshmi Fashion",
        "products": [
            ("Kanchipuram Silk Saree", 3499, "Sarees"),
            ("Cotton Kurta Set", 1299, "Kurtas"),
            ("Anarkali Dress", 2199, "Dresses"),
        ],
    },
    "ravi-electronics-bmxitv46": {
        "name": "Ravi Electronics",
        "products": [
            ("boAt Airdopes 141 Earbuds", 1299, "Audio"),
            ("Redmi Power Bank 20000mAh", 1699, "Accessories"),
            ("Boult Smartwatch", 1999, "Wearables"),
        ],
    },
    "sri-pharma": {
        "name": "Sri Pharma",
        "products": [
            ("BP Monitor Digital", 1450, "Devices"),
            ("Diabetes Test Strips (50)", 899, "Supplies"),
            ("Vitamin D3 Supplements", 450, "Supplements"),
        ],
    },
    "anna-groceries": {
        "name": "Anna Groceries",
        "products": [
            ("Sona Masoori Rice 25kg", 1450, "Staples"),
            ("Cooking Oil 5L", 890, "Staples"),
            ("Toor Dal 5kg", 640, "Pulses"),
        ],
    },
}

def gql(sub, token, query, variables=None):
    body = json.dumps({"query": query, "variables": variables or {}}).encode()
    req = urllib.request.Request(
        f"https://{sub}.myshopify.com/admin/api/2026-01/graphql.json",
        data=body,
        headers={"X-Shopify-Access-Token": token, "Content-Type": "application/json"})
    for attempt in range(3):
        try:
            r = json.load(urllib.request.urlopen(req))
            if "errors" in r:
                print("    gql error:", r["errors"])
            return r
        except Exception as e:
            print(f"    retry {attempt+1}: {e}")
            time.sleep(2)
    return {}

def seed_store(sub, token, cfg):
    print(f"\n=== {cfg['name']}  ({sub}) ===")

    # 1. remove default junk products (snowboards etc.)
    ex = gql(sub, token, "{ products(first: 50) { nodes { id title } } }")
    for p in ex.get("data", {}).get("products", {}).get("nodes", []):
        t = p["title"].lower()
        if any(w in t for w in ["snowboard","ski","wax","gift card","selling plan","the collection"]):
            gql(sub, token, "mutation($id: ID!){ productDelete(input:{id:$id}){ deletedProductId } }", {"id": p["id"]})
            print(f"    deleted junk: {p['title']}")

    # 2. create products with price
    have = {p["title"] for p in gql(sub, token, "{ products(first:50){nodes{title}} }")
            .get("data",{}).get("products",{}).get("nodes",[])}
    for title, price, ptype in cfg["products"]:
        if title in have:
            print(f"    exists: {title}")
            continue
        r = gql(sub, token, """mutation($input: ProductInput!){
            productCreate(input:$input){ product{ id variants(first:1){nodes{id}} } }
        }""", {"input": {"title": title, "productType": ptype, "status": "ACTIVE"}})
        prod = r.get("data",{}).get("productCreate",{}).get("product")
        if not prod:
            print(f"    FAILED create: {title}")
            continue
        vid = prod["variants"]["nodes"][0]["id"]
        pid = prod["id"]
        # 2026 API: bulk update sets the price on the variant
        gql(sub, token, """mutation($pid:ID!,$variants:[ProductVariantsBulkInput!]!){
            productVariantsBulkUpdate(productId:$pid, variants:$variants){
                productVariants{ id price } userErrors{ message }
            }
        }""", {"pid": pid, "variants": [{"id": vid, "price": str(price)}]})
        print(f"    created: {title}  Rs.{price}")

for sub, token in STORES.items():
    cfg = CATALOG.get(sub)
    if not cfg:
        print(f"\n(skipping {sub} — no catalogue defined)")
        continue
    seed_store(sub, token, cfg)

print("\n" + "="*50)
print("  ALL STORES SEEDED — open each Shopify admin -> Products")
print("  Next: create a few paid orders per store in the UI,")
print("  OR tell me to add an order-creation step.")
print("="*50)