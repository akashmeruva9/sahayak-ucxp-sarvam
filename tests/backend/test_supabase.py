"""Gate B9 -- publishing manifests to Supabase, and remembering who signs in.

Run from the repo root:  ./venv/bin/python -m pytest tests/backend/test_supabase.py -v

Nothing here touches the real project. Every HTTP call is intercepted, which is
the point: the shared database is read by the runtime, and a test that could
write to it could publish a business that does not exist.

The contract these tests pin down lives in `docs/manifest-sync.md` on `main`.
Two codebases agree on those column names; if this file and that one ever
disagree, that one wins.
"""

import io
import json
import os
import sys
import urllib.error

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from Dashboard.backend import store, supabase  # noqa: E402

URL = "https://project.supabase.co"
KEY = "service-role-key"


@pytest.fixture()
def configured(monkeypatch):
    monkeypatch.setenv("SUPABASE_URL", URL)
    monkeypatch.setenv("SUPABASE_SERVICE_KEY", KEY)


@pytest.fixture()
def client(tmp_path):
    store.set_db_path(str(tmp_path / "supabase.db"))
    from fastapi.testclient import TestClient
    from Dashboard.backend.main import app
    with TestClient(app) as test_client:
        yield test_client
    store.set_db_path(os.environ.get("UCXP_DB", store.DEFAULT_DB))


class Sent:
    """Captures what would have gone over the wire."""

    def __init__(self):
        self.calls = []

    def __call__(self, request, timeout=None):
        body = request.data.decode("utf-8") if request.data else None
        self.calls.append({
            "method": request.get_method(),
            "url": request.full_url,
            "headers": {k.lower(): v for k, v in request.headers.items()},
            "body": json.loads(body) if body else None,
            "timeout": timeout,
        })
        return _Response(b'[]')


class _Response:
    def __init__(self, payload):
        self._payload = payload

    def read(self):
        return self._payload

    def __enter__(self):
        return self

    def __exit__(self, *_):
        return False


@pytest.fixture()
def sent(monkeypatch):
    recorder = Sent()
    monkeypatch.setattr(supabase.urllib.request, "urlopen", recorder)
    return recorder


# --------------------------------------------------------------------------
# Configuration
# --------------------------------------------------------------------------
def test_not_configured_is_a_normal_state_not_an_error():
    """Local development and the whole suite run with no Supabase at all."""
    assert supabase.enabled() is False
    result = supabase.publish_manifest("ravi-electronics", {"a": 1})
    assert result["ok"] is False
    assert result["skipped"] is True


def test_either_name_for_the_service_key_works(monkeypatch):
    """manifest-sync.md says SERVICE_KEY; the Supabase console says SERVICE_ROLE_KEY."""
    monkeypatch.setenv("SUPABASE_URL", URL)
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "from-the-console")
    assert supabase.enabled() is True
    assert supabase.service_key() == "from-the-console"

    monkeypatch.setenv("SUPABASE_SERVICE_KEY", "from-the-doc")
    assert supabase.service_key() == "from-the-doc"


def test_a_quoted_value_is_unwrapped(monkeypatch):
    monkeypatch.setenv("SUPABASE_URL", '"{}"'.format(URL))
    monkeypatch.setenv("SUPABASE_SERVICE_KEY", "'quoted-key'")
    assert supabase.base_url() == URL
    assert supabase.service_key() == "quoted-key"


def test_a_trailing_slash_does_not_double_up(monkeypatch, sent):
    monkeypatch.setenv("SUPABASE_URL", URL + "/")
    monkeypatch.setenv("SUPABASE_SERVICE_KEY", KEY)
    supabase.publish_manifest("ravi", {})
    assert "//rest" not in sent.calls[0]["url"].replace("https://", "")


# --------------------------------------------------------------------------
# The write itself
# --------------------------------------------------------------------------
def test_publish_sends_the_columns_the_runtime_reads(configured, sent):
    manifest = {"business_id": "ravi-electronics", "capabilities": ["track_order"]}
    supabase.publish_manifest("ravi-electronics", manifest, version=3,
                              name="Ravi Electronics", category="Electronics")

    call = sent.calls[0]
    assert call["method"] == "POST"
    assert call["url"].startswith(URL + "/rest/v1/ucxp_manifests?")
    # Without on_conflict + merge-duplicates a second activation is a primary
    # key conflict rather than an update.
    assert "on_conflict=business_id" in call["url"]
    assert "merge-duplicates" in call["headers"]["prefer"]
    assert call["headers"]["apikey"] == KEY
    assert call["headers"]["authorization"] == "Bearer " + KEY
    assert call["body"] == {
        "business_id": "ravi-electronics",
        "manifest": manifest,
        "status": "active",
        "version": 3,
        "name": "Ravi Electronics",
        "category": "Electronics",
    }


def test_the_whole_manifest_goes_up_not_a_summary(configured, sent):
    """The runtime's normalizer must see the same document a judge would."""
    manifest = {"business_id": "x", "nested": {"deep": [1, 2, {"three": True}]}}
    supabase.publish_manifest("x", manifest)
    assert sent.calls[0]["body"]["manifest"] == manifest


def test_unpublish_deletes_only_that_business(configured, sent):
    supabase.unpublish_manifest("ravi-electronics")
    call = sent.calls[0]
    assert call["method"] == "DELETE"
    assert "business_id=eq.ravi-electronics" in call["url"]


def test_a_missing_table_says_to_run_the_schema(configured, monkeypatch):
    def boom(request, timeout=None):
        raise urllib.error.HTTPError(
            request.full_url, 404, "Not Found", {},
            io.BytesIO(b'{"message":"relation \\"ucxp_manifests\\" does not exist"}'))

    monkeypatch.setattr(supabase.urllib.request, "urlopen", boom)
    result = supabase.publish_manifest("ravi", {})
    assert result["ok"] is False
    assert "db/schema.sql" in result["error"]


def test_an_unreachable_database_never_raises(configured, monkeypatch):
    def boom(request, timeout=None):
        raise urllib.error.URLError("connection refused")

    monkeypatch.setattr(supabase.urllib.request, "urlopen", boom)
    result = supabase.publish_manifest("ravi", {})
    assert result["ok"] is False
    assert "Could not reach Supabase" in result["error"]


# --------------------------------------------------------------------------
# Activation still works when the database does not
# --------------------------------------------------------------------------
@pytest.fixture()
def activatable(client, tmp_path, monkeypatch):
    """A business complete enough to activate, publishing into a temp directory.

    Reuses test_backend's section fixture so "complete" means the same thing in
    both files -- a second copy would drift and start passing for the wrong
    reason.
    """
    from Dashboard.backend import main as main_mod
    from tests.backend.test_backend import _complete_sections
    monkeypatch.setattr(main_mod, "MANIFEST_DIR", str(tmp_path / "manifests"))
    return store.create_business(name="Ravi Electronics", sections=_complete_sections())


def test_activation_reports_that_the_database_is_not_configured(client, activatable):
    body = client.post("/api/business/{}/activate".format(activatable)).json()
    assert body["ok"] is True, body
    assert body["database"] == {"ok": False, "configured": False, "error": ""}


def test_activation_publishes_the_manifest_it_just_wrote(client, activatable,
                                                         configured, sent):
    body = client.post("/api/business/{}/activate".format(activatable)).json()
    assert body["ok"] is True, body
    assert body["database"] == {"ok": True, "configured": True, "error": ""}

    posted = [c for c in sent.calls if "ucxp_manifests" in c["url"]][0]["body"]
    assert posted["business_id"] == activatable
    assert posted["status"] == "active"
    assert posted["version"] == body["version"] == 1
    assert posted["name"] == "Ravi Electronics"
    assert posted["category"] == "Electronics"
    # The row and the file the judge reads must be the same document.
    assert posted["manifest"] == body["manifest"]


def test_a_later_edit_republishes_rather_than_going_stale(client, activatable,
                                                          configured, sent):
    """"Changes republish automatically" has to mean the database too."""
    client.post("/api/business/{}/activate".format(activatable))
    sent.calls.clear()

    client.put("/api/business/{}/section/5".format(activatable),
               json={"data": {
                   "faqs": [{"q": "New question?", "a": "New answer."}],
                   "policies": {"return": "10 day returns on unopened items.",
                                "refund": "", "shipping": "",
                                "warranty": "1 year manufacturer warranty."}}})

    posted = [c for c in sent.calls if "ucxp_manifests" in c["url"]]
    assert posted, "an edit to a live business never reached the database"
    assert "New question?" in json.dumps(posted[-1]["body"]["manifest"])


def test_a_draft_is_never_published(client, configured, sent):
    """A draft in the dashboard must not become a live business in the app."""
    from tests.backend.test_backend import _complete_sections
    business_id = store.create_business(name="Still Drafting",
                                        sections=_complete_sections())
    client.put("/api/business/{}/section/5".format(business_id),
               json={"data": {"faqs": [], "policies": {}}})
    assert [c for c in sent.calls if "ucxp_manifests" in c["url"]] == []


def test_a_failed_publish_does_not_fail_the_activation(client, activatable,
                                                       configured, monkeypatch):
    """The merchant is not the person who can fix a database outage."""
    def boom(request, timeout=None):
        raise urllib.error.URLError("connection refused")

    monkeypatch.setattr(supabase.urllib.request, "urlopen", boom)
    body = client.post("/api/business/{}/activate".format(activatable)).json()
    assert body["ok"] is True, body
    assert body["database"]["ok"] is False
    assert body["database"]["configured"] is True
    assert body["database"]["error"]


def test_deleting_a_business_removes_its_row(client, configured, sent):
    business_id = client.post("/api/businesses", json={"name": "Gone Soon"}
                              ).json()["business"]["id"]
    client.request("DELETE", "/api/business/{}".format(business_id))
    deletes = [c for c in sent.calls if c["method"] == "DELETE"]
    assert any("business_id=eq.{}".format(business_id) in c["url"] for c in deletes)


# --------------------------------------------------------------------------
# People
# --------------------------------------------------------------------------
def test_a_sign_in_is_written_down(client):
    user = store.record_sign_in("Shop@Example.com ", "Shop Owner", "http://pic")
    assert user["email"] == "shop@example.com"          # normalised
    assert user["name"] == "Shop Owner"
    assert user["sign_in_count"] == 1
    assert user["first_seen"] == user["last_seen"]


def test_signing_in_again_counts_but_keeps_the_first_time(client):
    first = store.record_sign_in("shop@example.com", "Shop")
    again = store.record_sign_in("shop@example.com", "Shop Renamed")

    assert again["sign_in_count"] == 2
    assert again["first_seen"] == first["first_seen"]
    # A changed Google display name should follow through.
    assert again["name"] == "Shop Renamed"


def test_an_owner_with_no_sign_in_record_is_still_listed(client):
    """Anyone who signed in between ownership shipping and this table existing."""
    store.create_business(name="Old Shop", owner_email="early@example.com")
    store.record_sign_in("recent@example.com", "Recent")

    users = {u["email"]: u for u in store.list_users()}
    assert set(users) == {"early@example.com", "recent@example.com"}
    assert users["early@example.com"]["first_seen"] is None
    assert users["early@example.com"]["businesses"] == 1
    assert users["recent@example.com"]["businesses"] == 0


def test_the_user_list_is_admin_only(client, monkeypatch):
    monkeypatch.setenv("GOOGLE_CLIENT_ID", "test-client.apps.googleusercontent.com")
    monkeypatch.setenv("GOOGLE_CLIENT_SECRET", "test-secret")
    monkeypatch.setenv("UCXP_SESSION_SECRET", "test-session-secret")
    monkeypatch.setenv("UCXP_ADMIN_EMAILS", "boss@example.com")

    from Dashboard.backend import auth
    from tests.backend.test_auth import sign_in

    sign_in(client, "shop@example.com")
    assert client.get("/api/admin/users").status_code == 403

    sign_in(client, "boss@example.com")
    response = client.get("/api/admin/users")
    assert response.status_code == 200
    assert auth.is_admin("boss@example.com")


def test_the_user_list_reports_roles_and_counts(client):
    store.record_sign_in("boss@example.com", "Boss")
    store.record_sign_in("shop@example.com", "Shop")
    store.create_business(name="Theirs", owner_email="shop@example.com")

    body = client.get("/api/admin/users").json()
    assert body["stats"]["total"] == 2
    assert body["stats"]["with_businesses"] == 1
    assert body["database"]["configured"] is False


def test_a_sign_in_is_mirrored_without_blocking(configured, sent):
    thread = supabase.record_user_in_background({
        "email": "shop@example.com", "name": "Shop", "picture": "",
        "first_seen": "2026-07-28T00:00:00Z", "last_seen": "2026-07-28T00:00:00Z",
        "sign_in_count": 2, "is_admin": True})
    thread.join(timeout=5)

    call = sent.calls[0]
    assert call["url"].startswith(URL + "/rest/v1/ucxp_dashboard_users?")
    assert call["body"]["email"] == "shop@example.com"
    assert call["body"]["is_admin"] is True
    assert call["body"]["sign_in_count"] == 2


def test_nothing_is_mirrored_when_supabase_is_unset(sent):
    assert supabase.record_user_in_background({"email": "shop@example.com"}) is None
    assert sent.calls == []
