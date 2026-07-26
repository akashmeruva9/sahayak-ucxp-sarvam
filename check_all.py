import json, urllib.request
stores = json.load(open("stores.json"))
for sub, token in stores.items():
    try:
        req = urllib.request.Request(
            f"https://{sub}.myshopify.com/admin/api/2026-01/graphql.json",
            data=json.dumps({"query":"{ shop { name currencyCode } }"}).encode(),
            headers={"X-Shopify-Access-Token": token, "Content-Type":"application/json"})
        r = json.load(urllib.request.urlopen(req))
        shop = r["data"]["shop"]
        print(f"✅ {sub:28} → {shop['name']} ({shop['currencyCode']})")
    except Exception as e:
        print(f"❌ {sub:28} → {str(e)[:60]}")