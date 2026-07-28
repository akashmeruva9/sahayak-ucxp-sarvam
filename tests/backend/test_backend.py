"""Backend gates B1-B6.

Run from the repo root:  ./venv/bin/python -m pytest tests/backend -v

B1 hits the five real Shopify stores over the network. It is the only test that
needs stores.json and connectivity; it skips (rather than fails) if stores.json
is absent, so the suite still runs on a machine without the demo credentials.
"""

import json
import os
import re
import sys
import tempfile
import time

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from Dashboard.backend import manifest as manifest_mod  # noqa: E402
from Dashboard.backend import shopify_client, store, vault  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
STORES_JSON = os.path.join(ROOT, "stores.json")


@pytest.fixture()
def client(tmp_path):
    """A TestClient backed by a throwaway database."""
    store.set_db_path(str(tmp_path / "test.db"))
    from fastapi.testclient import TestClient
    from Dashboard.backend.main import app
    with TestClient(app) as test_client:
        yield test_client
    store.set_db_path(os.environ.get("UCXP_DB", store.DEFAULT_DB))


def _seeded_tokens():
    try:
        with open(STORES_JSON, "r", encoding="utf-8") as handle:
            return json.load(handle)
    except (OSError, ValueError):
        return {}


# --------------------------------------------------------------------------
# B1 -- each of the 5 stores returns real orders via shopify_client
# --------------------------------------------------------------------------
@pytest.mark.parametrize("subdomain", list(_seeded_tokens().keys()) or ["<none>"])
def test_b1_all_five_stores_return_real_orders(subdomain):
    tokens = _seeded_tokens()
    if not tokens:
        pytest.skip("stores.json not present -- no seeded Shopify credentials")

    result = shopify_client.verify_connection(subdomain, tokens[subdomain])
    assert result["ok"] is True
    assert result["shop_name"], "{} returned no shop name".format(subdomain)
    assert result["currency"] == "INR"
    assert result["order_count"] >= 1, "{} returned no orders".format(subdomain)

    orders = shopify_client.fetch_orders(subdomain, tokens[subdomain])
    assert orders, "{} returned an empty order list".format(subdomain)
    for order in orders:
        assert order["order_id"], "an order came back without an order number"
        assert not order["order_id"].startswith("#"), "the '#' prefix was not stripped"


def test_b1_five_stores_are_configured():
    tokens = _seeded_tokens()
    if not tokens:
        pytest.skip("stores.json not present")
    assert len(tokens) >= 5, "expected at least 5 seeded stores, found {}".format(len(tokens))


# --------------------------------------------------------------------------
# B2 -- bad token -> {ok: false, error}, HTTP 200, no stack trace
# --------------------------------------------------------------------------
def test_b2_bad_token_returns_clean_error(client):
    response = client.post("/api/connect/shopify", json={
        "subdomain": "ravi-electronics-bmxitv46",
        "token": "shpat_this_token_is_not_real_at_all",
    })
    assert response.status_code == 200, "a bad token must not produce an error status"
    body = response.json()
    assert body["ok"] is False
    assert body["error"] and isinstance(body["error"], str)

    raw = response.text
    assert "Traceback" not in raw
    assert "File \"" not in raw
    assert "shpat_" not in raw, "the rejected token was echoed back to the client"


def test_b2_bad_subdomain_returns_clean_error(client):
    response = client.post("/api/connect/shopify", json={
        "subdomain": "definitely-not-a-real-store-xyzzy-42",
        "token": "shpat_whatever",
    })
    assert response.status_code == 200
    body = response.json()
    assert body["ok"] is False
    assert "Traceback" not in response.text


def test_b2_unknown_business_is_friendly_not_a_trace(client):
    response = client.get("/api/business/nope-does-not-exist")
    assert response.status_code == 404
    assert response.json() == {"error": "We couldn't find that business."}
    assert "Traceback" not in response.text


# --------------------------------------------------------------------------
# B3 -- no customer/PII field appears in any GraphQL query string
# --------------------------------------------------------------------------
PII_PATTERN = re.compile(
    r"\b(customer|customers|email|emailAddress|phone|phoneNumber|firstName|lastName"
    r"|displayName|defaultAddress|shippingAddress|billingAddress|addresses?)\b",
    re.IGNORECASE)


def test_b3_no_pii_fields_in_any_graphql_query():
    for query in shopify_client.ALL_QUERIES:
        match = PII_PATTERN.search(query)
        assert match is None, (
            "GraphQL query requests PII field '{}'. Shopify Basic blocks customer "
            "PII and UCXP identifies customers by order number only.".format(
                match.group(0) if match else ""))


def test_b3_client_module_defines_no_other_queries():
    """Guard against a query constant added outside ALL_QUERIES escaping the scan.

    Scans every module-level `*_QUERY = ...` assignment, not docstrings -- the
    module docstring legitimately mentions `customer` while explaining the omission.
    """
    source = open(shopify_client.__file__, "r", encoding="utf-8").read()
    assignments = re.findall(
        r'^([A-Z_]*QUERY)\s*=\s*(?:"""(.*?)"""|"(.*?)")',
        source, re.DOTALL | re.MULTILINE)
    assert assignments, "no query constants found -- has the module been renamed?"
    for name, triple, single in assignments:
        body = triple or single
        assert PII_PATTERN.search(body) is None, (
            "GraphQL constant {} requests a PII field".format(name))
        assert body in shopify_client.ALL_QUERIES, (
            "{} is not listed in ALL_QUERIES, so gate B3 would not scan it".format(name))


def test_b3_live_orders_carry_no_customer_data():
    tokens = _seeded_tokens()
    if not tokens:
        pytest.skip("stores.json not present")
    subdomain = "ravi-electronics-bmxitv46"
    orders = shopify_client.fetch_orders(subdomain, tokens[subdomain])
    for order in orders:
        for key in order:
            assert PII_PATTERN.search(key) is None, (
                "order payload exposes field '{}'".format(key))


# --------------------------------------------------------------------------
# B4 -- manifest passes validate(), has credential_ref, has no shpat_ string
# --------------------------------------------------------------------------
def _complete_sections(with_shopify=True):
    sections = manifest_mod.default_sections()
    sections["1"] = {
        "name": "Ravi Electronics", "tagline": "Electronics you can trust",
        "desc": "Consumer electronics retailer in Hyderabad.",
        "category": "Electronics", "city": "Hyderabad",
        "email": "support@ravielectronics.in", "phone": "+91 40 2222 3333",
        "website": "https://ravielectronics.in", "hours": "Mon-Sat 10:00-20:00 IST",
        "logoUrl": "",
    }
    if with_shopify:
        sections["2"] = {
            "type": "shopify", "connected": True,
            "store": "ravi-electronics-bmxitv46", "base": "",
            "auth": "api_key_header", "header": "X-API-Key", "linkSent": False,
            "productCount": 3, "orderCount": 3, "currency": "INR",
            "credentialRef": "vault://ravi-electronics",
        }
        sections["3"] = {"caps": {
            "track_order": manifest_mod.shopify_contract(
                "track_order", "ravi-electronics", "ravi-electronics-bmxitv46"),
        }}
    else:
        sections["2"] = {
            "type": "custom", "connected": False, "store": "",
            "base": "https://api.ravielectronics.in/v1",
            "auth": "api_key_header", "header": "X-API-Key", "linkSent": True,
            "credentialRef": "vault://ravi-electronics",
        }
        contract = manifest_mod.empty_contract("track_order")
        contract.update({
            "endpoint": "/orders/{order_id}", "method": "GET",
            "description": "Look up an order by number.",
            "request": {"headers": [{"name": "X-API-Key", "value": "{{credential_ref}}"}],
                        "body": ""},
            "response": {"sample": '{"status": "shipped"}',
                         "mapping": [{"field": "status", "path": "$.status"}]},
            "errors": [{"code": "404", "meaning": "Not found",
                        "customer_message": "I couldn't find that order."}],
        })
        sections["3"] = {"caps": {"track_order": contract}}

    sections["4"] = {"selected": ["te", "hi", "en"], "primary": "te"}
    sections["5"] = {
        "faqs": [{"q": "Do you deliver to villages?", "a": "Yes, 5-7 days statewide."}],
        "policies": {"return": "10 day returns on unopened items.", "refund": "",
                     "shipping": "", "warranty": "1 year manufacturer warranty."},
    }
    sections["6"] = {"fr": "48", "res": "30", "gName": "R. Kumar",
                     "gEmail": "grievance@ravielectronics.in", "auto": True}
    return sections


def test_b4_manifest_validates_and_holds_no_secret():
    sections = _complete_sections()
    built = manifest_mod.assemble("ravi-electronics", sections)

    ok, errors = manifest_mod.validate(built)
    assert ok, "manifest failed validation: {}".format(errors)

    assert built["data_source"]["credential_ref"] == "vault://ravi-electronics"
    assert built["identify_by"] == "order_number"
    assert built["data_source"]["pii_available"] is False

    serialized = json.dumps(built, ensure_ascii=False)
    assert "shpat_" not in serialized, "a raw Shopify token reached the manifest"
    for text in manifest_mod._walk_strings(built):
        assert not text.startswith("shpat_")


def test_b4_validator_rejects_a_planted_token():
    sections = _complete_sections()
    built = manifest_mod.assemble("ravi-electronics", sections)
    built["data_source"]["credential_ref"] = "shpat_a_real_looking_token_value"
    ok, errors = manifest_mod.validate(built)
    assert ok is False
    assert any("token" in e.lower() for e in errors)


def test_b4_validator_rejects_pii_and_bad_identify_by():
    sections = _complete_sections()
    built = manifest_mod.assemble("ravi-electronics", sections)
    built["identify_by"] = "customer_name"
    built["data_source"]["pii_available"] = True
    ok, errors = manifest_mod.validate(built)
    assert ok is False
    assert any("identify_by" in e for e in errors)
    assert any("pii_available" in e for e in errors)


def test_b4_custom_rest_manifest_also_validates():
    sections = _complete_sections(with_shopify=False)
    built = manifest_mod.assemble("ravi-electronics", sections)
    ok, errors = manifest_mod.validate(built)
    assert ok, errors
    assert built["data_source"]["type"] == "custom"
    assert built["data_source"]["credential_ref"].startswith("vault://")


def test_b4_protocol_export_is_wellformed():
    sections = _complete_sections()
    built = manifest_mod.assemble("ravi-electronics", sections)
    protocol = manifest_mod.to_protocol(built)
    for key in ("ucxp_version", "manifest_version", "business", "auth",
                "supported_languages", "capabilities", "api_mappings",
                "escalation_rules"):
        assert key in protocol, "protocol export is missing {}".format(key)
    for cap in protocol["capabilities"]:
        assert cap["action"]["api_mapping"] in protocol["api_mappings"], (
            "capability {} points at a missing api_mapping".format(cap["name"]))
    assert "shpat_" not in json.dumps(protocol, ensure_ascii=False)


# --------------------------------------------------------------------------
# B5 -- activate writes files that reload and revalidate
# --------------------------------------------------------------------------
def test_b5_activate_writes_and_reloads(client, tmp_path, monkeypatch):
    from Dashboard.backend import main as main_mod
    manifest_dir = tmp_path / "manifests"
    monkeypatch.setattr(main_mod, "MANIFEST_DIR", str(manifest_dir))

    business_id = store.create_business(name="Ravi Electronics",
                                        sections=_complete_sections())
    response = client.post("/api/business/{}/activate".format(business_id))
    assert response.status_code == 200
    body = response.json()
    assert body["ok"] is True, body
    assert body["version"] == 1

    flat_path = manifest_dir / "{}.json".format(business_id)
    protocol_path = manifest_dir / "{}.protocol.json".format(business_id)
    assert flat_path.exists(), "activation did not write the flat manifest"
    assert protocol_path.exists(), "activation did not write the protocol export"

    reloaded = json.loads(flat_path.read_text(encoding="utf-8"))
    ok, errors = manifest_mod.validate(reloaded)
    assert ok, "the written manifest does not re-validate: {}".format(errors)
    assert reloaded["status"] == "active"
    assert "shpat_" not in flat_path.read_text(encoding="utf-8")
    assert "shpat_" not in protocol_path.read_text(encoding="utf-8")

    json.loads(protocol_path.read_text(encoding="utf-8"))  # parses


def test_b5_activate_twice_updates_not_duplicates(client, tmp_path, monkeypatch):
    from Dashboard.backend import main as main_mod
    manifest_dir = tmp_path / "manifests"
    monkeypatch.setattr(main_mod, "MANIFEST_DIR", str(manifest_dir))

    business_id = store.create_business(name="Ravi Electronics",
                                        sections=_complete_sections())
    first = client.post("/api/business/{}/activate".format(business_id)).json()
    second = client.post("/api/business/{}/activate".format(business_id)).json()
    assert first["ok"] and second["ok"]
    assert second["version"] == first["version"] + 1

    listed = client.get("/api/businesses").json()["businesses"]
    assert len([b for b in listed if b["id"] == business_id]) == 1, "duplicate row created"
    assert len(list(manifest_dir.glob("{}*.json".format(business_id)))) == 2


def test_b5_incomplete_business_cannot_activate(client):
    business_id = store.create_business(name="Half Done")
    body = client.post("/api/business/{}/activate".format(business_id)).json()
    assert body["ok"] is False
    assert body["missing"], "an incomplete business activated with no blocking items"


# --------------------------------------------------------------------------
# B6 -- 200 businesses can be created and listed
# --------------------------------------------------------------------------
def test_b6_two_hundred_businesses(client):
    for i in range(200):
        store.create_business(name="Merchant {:03d}".format(i))

    started = time.time()
    response = client.get("/api/businesses")
    elapsed = time.time() - started

    assert response.status_code == 200
    businesses = response.json()["businesses"]
    assert len(businesses) >= 200, "expected 200+ businesses, got {}".format(len(businesses))
    assert len({b["id"] for b in businesses}) == len(businesses), "duplicate ids"
    assert elapsed < 15, "listing 200 businesses took {:.1f}s".format(elapsed)

    admin = client.get("/api/admin/merchants")
    assert admin.status_code == 200
    assert admin.json()["stats"]["total"] >= 200


# --------------------------------------------------------------------------
# Contract parity: the frontend mirror must match the backend vocabulary
# --------------------------------------------------------------------------
def test_frontend_mirrors_backend_vocabulary():
    mirror = os.path.join(ROOT, "Dashboard", "frontend", "src", "lib", "contract.js")
    if not os.path.exists(mirror):
        pytest.skip("frontend not scaffolded yet")
    source = open(mirror, "r", encoding="utf-8").read()

    from Dashboard.backend import constants
    for code in constants.LANGUAGE_CODES:
        assert '"{}"'.format(code) in source or "'{}'".format(code) in source, (
            "frontend contract.js is missing language '{}'".format(code))
    for key in constants.CAPABILITY_KEYS:
        assert key in source, "frontend contract.js is missing capability '{}'".format(key)
    for category in constants.CATEGORIES:
        assert category in source, "frontend is missing category '{}'".format(category)


# --------------------------------------------------------------------------
# Vault: the secret never leaves the server
# --------------------------------------------------------------------------
def test_vault_never_returns_secret_over_the_api(client):
    business_id = store.create_business(name="Vault Check")
    vault.put(business_id, "shpat_secret_value_do_not_leak")

    assert vault.get(business_id) == "shpat_secret_value_do_not_leak"

    for path in ("/api/businesses", "/api/admin/merchants",
                 "/api/business/{}".format(business_id),
                 "/api/business/{}/manifest".format(business_id)):
        assert "shpat_" not in client.get(path).text, "a secret leaked via {}".format(path)


# --------------------------------------------------------------------------
# Lifecycle: activation and deletion leave the manifests/ directory consistent
# --------------------------------------------------------------------------
def _fill_sections_via_api(client, business_id, *, source="custom", with_capability=True):
    """Fill every section activation checks, so tests can vary one thing at a time."""
    put = lambda n, data: client.put(
        "/api/business/{}/section/{}".format(business_id, n), json={"data": data})
    put(1, {"name": "Lifecycle Co", "category": "Electronics",
            "city": "Bengaluru", "email": "care@lifecycle.in"})
    if source == "custom":
        put(2, {"type": "custom", "base": "https://api.lifecycle.in",
                "auth": "api_key_header", "header": "X-API-Key",
                "credentialRef": "vault://{}".format(business_id)})
    else:
        put(2, {"type": "none"})
    if with_capability:
        put(3, {"caps": {"track_order": {
            "name": "track_order", "enabled": True, "source": "custom",
            "endpoint": "/orders/{order_id}", "method": "GET",
            "request": {"headers": [], "body": '{"a":1}'},
            "response": {"sample": '{"status":"shipped"}', "mapping": []},
            "parameters": {"path": [], "query": []}, "errors": []}}})
    put(4, {"selected": ["en", "te"], "primary": "en"})
    put(6, {"fr": "48", "res": "30", "auto": True})


def test_delete_removes_the_published_manifest_files(client, tmp_path, monkeypatch):
    """A deleted business must not stay published on disk."""
    from Dashboard.backend import main as main_mod
    monkeypatch.setattr(main_mod, "MANIFEST_DIR", str(tmp_path))

    business_id = store.create_business(name="Lifecycle Co")
    _fill_sections_via_api(client, business_id)
    activated = client.post("/api/business/{}/activate".format(business_id)).json()
    assert activated["ok"] is True, activated

    flat = tmp_path / "{}.json".format(business_id)
    protocol = tmp_path / "{}.protocol.json".format(business_id)
    assert flat.exists() and protocol.exists(), "activation should write both files"

    assert client.delete("/api/business/{}".format(business_id)).status_code == 200
    assert not flat.exists(), "the flat manifest outlived its business"
    assert not protocol.exists(), "the protocol manifest outlived its business"


def test_delete_is_still_clean_when_nothing_was_published(client, tmp_path, monkeypatch):
    from Dashboard.backend import main as main_mod
    monkeypatch.setattr(main_mod, "MANIFEST_DIR", str(tmp_path))
    business_id = store.create_business(name="Never Activated")
    response = client.delete("/api/business/{}".format(business_id))
    assert response.status_code == 200
    assert response.json()["files_removed"] == []


def test_data_source_without_a_capability_cannot_activate(client, tmp_path, monkeypatch):
    from Dashboard.backend import main as main_mod
    monkeypatch.setattr(main_mod, "MANIFEST_DIR", str(tmp_path))
    """An 'active' merchant that can do nothing is worse than an unfinished one."""
    business_id = store.create_business(name="No Caps Co")
    _fill_sections_via_api(client, business_id, source="custom", with_capability=False)

    state = client.get("/api/business/{}".format(business_id)).json()
    blocking = [item for item in state["missing"] if item["section"] == 3]
    assert blocking, "a custom data source with no capabilities should block activation"

    result = client.post("/api/business/{}/activate".format(business_id)).json()
    assert result["ok"] is False
    assert store.get_business(business_id)["status"] == "draft"


def test_no_data_source_may_activate_without_capabilities(client, tmp_path, monkeypatch):
    from Dashboard.backend import main as main_mod
    monkeypatch.setattr(main_mod, "MANIFEST_DIR", str(tmp_path))
    """Answering only from the knowledge base is a supported configuration."""
    business_id = store.create_business(name="Knowledge Only Co")
    _fill_sections_via_api(client, business_id, source="none", with_capability=False)

    state = client.get("/api/business/{}".format(business_id)).json()
    assert not [item for item in state["missing"] if item["section"] == 3], (
        "a no-data-source business must not be forced to declare capabilities")

    result = client.post("/api/business/{}/activate".format(business_id)).json()
    assert result["ok"] is True, result
