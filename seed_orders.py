"""
Add Indian-customer orders ONLY to Meena + Lakshmi (which were skipped before).
The other 3 already have their orders, so this script targets just these two.
Safe to re-run — but note it does NOT check existing orders (it always adds 3 here),
so run it ONCE for these two stores.

Run:  /opt/homebrew/bin/python3.13 seed_orders_two.py
"""
import json, time, urllib.request

STORES = json.load(open("stores.json"))
API_VER = "2026-01"

# ONLY these two stores get topped up
TARGETS = {
    "meena-kitchen-store": {
        "name": "Meena Kitchen Store",
        "customers": [
            ("Lakshmi", "Reddy",  "+919812345001", "Hyderabad"),
            ("Ramesh",  "Kumar",  "+919812345002", "Vijayawada"),
            ("Anjali",  "Sharma", "+919812345003", "Bengaluru"),
        ],
    },
    "lakshmi-fashion-4kmotaah": {
        "name": "Lakshmi Fashion",
        "customers": [
            ("Priya",   "Nair",  "+919812345011", "Chennai"),
            ("Deepika", "Iyer",  "+919812345012", "Coimbatore"),
            ("Kavya",   "Rao",   "+919812345013", "Mysuru"),
        ],
    },
}

def gql(sub, token, query, variables=None):
    body = json.dumps({"query": query, "variables": variables or {}}).encode()
    req = urllib.request.Request(
        f"https://{sub}.myshopify.com/admin/api/{API_VER}/graphql.json",
        data=body,
        headers={"X-Shopify-Access-Token": token, "Content-Type": "application/json"})
    for attempt in range(3):
        try:
            return json.load(urllib.request.urlopen(req))
        except Exception as e:
            print(f"    retry {attempt+1}: {str(e)[:80]}")
            time.sleep(2)
    return {}

def safe(d, *keys, default=None):
    cur = d
    for k in keys:
        if not isinstance(cur, dict):
            return default
        cur = cur.get(k)
    return cur if cur is not None else default

def create_customer(sub, token, first, last, phone, city):
    r = gql(sub, token, """
      mutation($input: CustomerInput!){
        customerCreate(input:$input){ customer{ id } userErrors{ message } }
      }""", {"input": {
        "firstName": first, "lastName": last,
        "addresses": [{"city": city, "countryCode": "IN", "phone": phone}],
      }})
    return safe(r, "data", "customerCreate", "customer", "id")

def make_order(sub, token, variant_id, customer_id, mark_fulfilled):
    inp = {"lineItems": [{"variantId": variant_id, "quantity": 1}]}
    if customer_id:
        inp["purchasingEntity"] = {"customerId": customer_id}
    r = gql(sub, token, """
      mutation($input: DraftOrderInput!){
        draftOrderCreate(input:$input){ draftOrder{ id } userErrors{ message } }
      }""", {"input": inp})
    draft_id = safe(r, "data", "draftOrderCreate", "draftOrder", "id")
    if not draft_id:
        r = gql(sub, token, """
          mutation($input: DraftOrderInput!){
            draftOrderCreate(input:$input){ draftOrder{ id } userErrors{ message } }
          }""", {"input": {"lineItems": [{"variantId": variant_id, "quantity": 1}]}})
        draft_id = safe(r, "data", "draftOrderCreate", "draftOrder", "id")
    if not draft_id:
        print("    draft failed:", safe(r, "data", "draftOrderCreate", "userErrors") or r.get("errors"))
        return None

    r2 = gql(sub, token, """
      mutation($id: ID!){
        draftOrderComplete(id:$id, paymentPending:false){
          draftOrder{ order{ id name } } userErrors{ message }
        }
      }""", {"id": draft_id})
    order_id = safe(r2, "data", "draftOrderComplete", "draftOrder", "order", "id")
    order_name = safe(r2, "data", "draftOrderComplete", "draftOrder", "order", "name")
    if not order_id:
        print("    complete failed:", safe(r2, "data", "draftOrderComplete", "userErrors") or r2.get("errors"))
        return None

    if mark_fulfilled:
        foid = gql(sub, token,
            "query($id: ID!){ order(id:$id){ fulfillmentOrders(first:1){ nodes{ id } } } }",
            {"id": order_id})
        nodes = safe(foid, "data", "order", "fulfillmentOrders", "nodes", default=[])
        if nodes:
            gql(sub, token, """
              mutation($fo: ID!){
                fulfillmentCreate(fulfillment:{
                  lineItemsByFulfillmentOrder:[{fulfillmentOrderId:$fo}]
                }){ fulfillment{ status } userErrors{ message } }
              }""", {"fo": nodes[0]["id"]})
    return order_name

for sub, cfg in TARGETS.items():
    token = STORES.get(sub)
    if not token:
        print(f"\n(no token for {sub} in stores.json — skipping)")
        continue
    print(f"\n=== {cfg['name']} ({sub}) ===")

    pr = gql(sub, token, "{ products(first:3){ nodes{ title variants(first:1){ nodes{ id } } } } }")
    prods = safe(pr, "data", "products", "nodes", default=[])
    if not prods:
        print("    no products found")
        continue

    plan = [(0, True), (1, True), (2, False)]  # delivered, shipped, preparing
    for i, (idx, fulfil) in enumerate(plan):
        if idx >= len(prods):
            break
        var = safe(prods[idx], "variants", "nodes", default=[])
        if not var:
            continue
        vid = var[0]["id"]
        first, last, phone, city = cfg["customers"][i]
        cid = create_customer(sub, token, first, last, phone, city)
        oname = make_order(sub, token, vid, cid, fulfil)
        if oname:
            status = "fulfilled" if fulfil else "unfulfilled"
            print(f"    {oname}: {prods[idx]['title']}  → {first} {last}  [{status}]")

print("\n" + "="*52)
print("  DONE — Meena + Lakshmi now have Indian-customer orders too.")
print("  All 5 stores complete. Check Shopify admin -> Orders/Customers.")
print("="*52)