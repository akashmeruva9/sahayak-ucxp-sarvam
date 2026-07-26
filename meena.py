"""Set correct INR prices on Meena's existing products (they're at Rs.0)."""
import json, urllib.request
STORES = json.load(open("stores.json"))
sub = "meena-kitchen-store"
token = STORES[sub]
API = f"https://{sub}.myshopify.com/admin/api/2026-01/graphql.json"
HEAD = {"X-Shopify-Access-Token": token, "Content-Type": "application/json"}

PRICES = {
    "Prestige Mixer Grinder 750W": "4499",
    "Butterfly Pressure Cooker 5L": "2199",
    "Bajaj Induction Cooktop 1900W": "2799",
    "Pigeon Non-Stick Dosa Tawa": "899",
    "Milton Thermosteel Flask 1L": "1099",
}

def gql(q, v=None):
    body = json.dumps({"query": q, "variables": v or {}}).encode()
    req = urllib.request.Request(API, data=body, headers=HEAD)
    return json.load(urllib.request.urlopen(req))

r = gql("{ products(first:20){ nodes{ id title variants(first:1){ nodes{ id } } } } }")
for p in r["data"]["products"]["nodes"]:
    price = PRICES.get(p["title"])
    if not price:
        continue
    vid = p["variants"]["nodes"][0]["id"]
    res = gql("""mutation($pid:ID!,$variants:[ProductVariantsBulkInput!]!){
        productVariantsBulkUpdate(productId:$pid, variants:$variants){
            productVariants{ price } userErrors{ message }
        }
    }""", {"pid": p["id"], "variants": [{"id": vid, "price": price}]})
    err = res.get("data",{}).get("productVariantsBulkUpdate",{}).get("userErrors")
    print(f"  {p['title']:34} -> Rs.{price}  {'OK' if not err else err}")

print("\nDone. Re-run fetch.py to confirm Meena prices.")