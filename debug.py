"""
Diagnose why customer names come back as None.
Checks: (1) do customers actually have names stored?
        (2) what scopes does the token have?
        (3) raw API response for a customer.
"""
import json, urllib.request
STORES = json.load(open("stores.json"))
sub = "ravi-electronics-bmxitv46"   # test on Ravi (freshly seeded)
token = STORES[sub]
API = f"https://{sub}.myshopify.com/admin/api/2026-01/graphql.json"
HEAD = {"X-Shopify-Access-Token": token, "Content-Type": "application/json"}

def gql(q, v=None):
    body = json.dumps({"query": q, "variables": v or {}}).encode()
    req = urllib.request.Request(API, data=body, headers=HEAD)
    return json.load(urllib.request.urlopen(req))

print("=== 1. Raw customer query (all name fields) ===")
r = gql("""{ customers(first: 5) { nodes {
    id firstName lastName displayName defaultEmailAddress { emailAddress }
    defaultPhoneNumber { phoneNumber }
} } }""")
print(json.dumps(r, indent=2)[:1500])

print("\n=== 2. Order -> customer link ===")
r2 = gql("""{ orders(first: 3) { nodes {
    name
    customer { id firstName lastName displayName }
} } }""")
print(json.dumps(r2, indent=2)[:1200])