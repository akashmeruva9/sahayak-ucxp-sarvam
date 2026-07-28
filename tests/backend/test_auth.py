"""Gate B8 -- Google sign-in, sessions, and who can see whose businesses.

Run from the repo root:  ./venv/bin/python -m pytest tests/backend/test_auth.py -v

Nothing here talks to Google. The one thing that genuinely needs Google -- the
code-for-identity exchange -- is exercised by feeding auth._claims_from_id_token
the token body Google would have returned, which is where every check that
matters actually lives.
"""

import base64
import json
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from Dashboard.backend import auth, envfile, store  # noqa: E402

CLIENT_ID = "test-client.apps.googleusercontent.com"
ADMIN = "boss@example.com"
MERCHANT = "shop@example.com"
OTHER = "rival@example.com"


@pytest.fixture()
def configured(monkeypatch):
    """A server with sign-in switched on."""
    monkeypatch.setenv("GOOGLE_CLIENT_ID", CLIENT_ID)
    monkeypatch.setenv("GOOGLE_CLIENT_SECRET", "test-secret")
    monkeypatch.setenv("UCXP_SESSION_SECRET", "test-session-secret")
    monkeypatch.setenv("UCXP_ADMIN_EMAILS", ADMIN)
    monkeypatch.delenv("UCXP_REQUIRE_AUTH", raising=False)
    monkeypatch.setenv("UCXP_AUTH_BASE_URL", "http://localhost:5173")


@pytest.fixture()
def client(tmp_path):
    store.set_db_path(str(tmp_path / "auth.db"))
    from fastapi.testclient import TestClient
    from Dashboard.backend.main import app
    with TestClient(app) as test_client:
        yield test_client
    store.set_db_path(os.environ.get("UCXP_DB", store.DEFAULT_DB))


def sign_in(test_client, email):
    """Give the client the cookie a completed Google sign-in would have set.

    The domain has to be spelled out, and it is "testserver.local" rather than
    "testserver" because http.cookiejar appends ".local" to any dotless host.
    Get it wrong and httpx files this cookie somewhere the server's own
    Set-Cookie never reaches, so logout looks broken when it is not.
    """
    token = auth.make_session({"email": email, "name": email.split("@")[0],
                               "picture": ""})
    test_client.cookies.clear()
    test_client.cookies.set(auth.SESSION_COOKIE, token, domain="testserver.local")


def id_token(**claims):
    payload = {"aud": CLIENT_ID, "iss": "https://accounts.google.com",
               "email": MERCHANT, "email_verified": True, "name": "Shop Owner"}
    payload.update(claims)
    body = base64.urlsafe_b64encode(
        json.dumps(payload).encode()).decode().rstrip("=")
    return "header.{}.signature".format(body)


# --------------------------------------------------------------------------
# Configuration -- off by default, and loudly wrong when it has to be on
# --------------------------------------------------------------------------
def test_auth_is_off_until_configured(monkeypatch):
    for name in ("GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "UCXP_SESSION_SECRET"):
        monkeypatch.delenv(name, raising=False)
    assert auth.enabled() is False
    # ...and it says so, rather than staying quiet about an open dashboard.
    assert any("open to anyone" in w for w in auth.check_startup_config())


def test_required_but_unconfigured_refuses_to_start(monkeypatch):
    monkeypatch.setenv("UCXP_REQUIRE_AUTH", "1")
    monkeypatch.delenv("GOOGLE_CLIENT_ID", raising=False)
    monkeypatch.setenv("GOOGLE_CLIENT_SECRET", "x")
    with pytest.raises(RuntimeError, match="GOOGLE_CLIENT_ID"):
        auth.check_startup_config()


def test_required_with_no_admins_refuses_to_start(monkeypatch, configured):
    monkeypatch.setenv("UCXP_REQUIRE_AUTH", "1")
    monkeypatch.setenv("UCXP_ADMIN_EMAILS", "")
    with pytest.raises(RuntimeError, match="UCXP_ADMIN_EMAILS"):
        auth.check_startup_config()


# --------------------------------------------------------------------------
# The unauthenticated shape stays exactly as it was
# --------------------------------------------------------------------------
def test_without_config_every_endpoint_stays_open(client, monkeypatch):
    for name in ("GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "UCXP_SESSION_SECRET"):
        monkeypatch.delenv(name, raising=False)
    assert client.get("/api/businesses").status_code == 200
    assert client.get("/api/admin/merchants").status_code == 200
    me = client.get("/api/auth/me").json()
    assert me == {"user": None, "auth_enabled": False}


# --------------------------------------------------------------------------
# The gate
# --------------------------------------------------------------------------
def test_signed_out_gets_401_not_a_redirect(client, configured):
    for path in ("/api/businesses", "/api/meta", "/api/admin/merchants"):
        response = client.get(path)
        assert response.status_code == 401, path
        # An XHR needs JSON it can render inline, never Google's HTML login page.
        assert response.json()["error"] == "Please sign in to continue."


def test_health_and_auth_endpoints_stay_public(client, configured):
    assert client.get("/api/health").status_code == 200
    body = client.get("/api/auth/me").json()
    assert body == {"user": None, "auth_enabled": True}


def test_login_redirects_to_google_with_state(client, configured):
    response = client.get("/api/auth/login", follow_redirects=False)
    assert response.status_code == 302
    location = response.headers["location"]
    assert location.startswith(auth.AUTHORIZE_URL)
    assert "client_id={}".format(CLIENT_ID).replace(".", "%2E") in location or CLIENT_ID in location
    assert "redirect_uri=http%3A%2F%2Flocalhost%3A5173%2Fapi%2Fauth%2Fcallback" in location
    assert auth.STATE_COOKIE in response.cookies


def test_signed_in_user_is_reported_with_its_role(client, configured):
    sign_in(client, ADMIN)
    assert client.get("/api/auth/me").json()["user"]["is_admin"] is True
    sign_in(client, MERCHANT)
    assert client.get("/api/auth/me").json()["user"]["is_admin"] is False


def test_logout_clears_the_session(client, configured):
    sign_in(client, MERCHANT)
    assert client.get("/api/auth/me").json()["user"] is not None
    client.post("/api/auth/logout")
    assert client.get("/api/auth/me").json()["user"] is None


def test_a_tampered_cookie_is_not_a_session(client, configured):
    sign_in(client, MERCHANT)
    good = client.cookies[auth.SESSION_COOKIE]
    client.cookies.set(auth.SESSION_COOKIE, good[:-4] + "aaaa")
    assert client.get("/api/auth/me").json()["user"] is None
    assert client.get("/api/businesses").status_code == 401


def test_admin_role_is_read_fresh_not_from_the_cookie(client, configured, monkeypatch):
    """Revoking admin has to take effect now, not in a fortnight."""
    sign_in(client, ADMIN)
    assert client.get("/api/auth/me").json()["user"]["is_admin"] is True
    monkeypatch.setenv("UCXP_ADMIN_EMAILS", OTHER)
    assert client.get("/api/auth/me").json()["user"]["is_admin"] is False


# --------------------------------------------------------------------------
# Ownership
# --------------------------------------------------------------------------
def test_a_new_business_belongs_to_whoever_created_it(client, configured):
    sign_in(client, MERCHANT)
    created = client.post("/api/businesses", json={"name": "Ravi Electronics"}).json()
    assert store.owner_of(created["business"]["id"]) == MERCHANT


def test_a_merchant_sees_only_their_own(client, configured):
    sign_in(client, MERCHANT)
    mine = client.post("/api/businesses", json={"name": "Mine"}).json()["business"]["id"]
    sign_in(client, OTHER)
    theirs = client.post("/api/businesses", json={"name": "Theirs"}).json()["business"]["id"]

    listed = [b["id"] for b in client.get("/api/businesses").json()["businesses"]]
    assert listed == [theirs]

    sign_in(client, MERCHANT)
    listed = [b["id"] for b in client.get("/api/businesses").json()["businesses"]]
    assert listed == [mine]


def test_an_admin_sees_everything(client, configured):
    sign_in(client, MERCHANT)
    client.post("/api/businesses", json={"name": "Mine"})
    sign_in(client, OTHER)
    client.post("/api/businesses", json={"name": "Theirs"})

    sign_in(client, ADMIN)
    listed = client.get("/api/businesses").json()["businesses"]
    assert len(listed) == 2


def test_a_merchant_cannot_reach_someone_elses_business(client, configured):
    sign_in(client, MERCHANT)
    victim = client.post("/api/businesses", json={"name": "Mine"}).json()["business"]["id"]

    sign_in(client, OTHER)
    assert client.get("/api/business/{}".format(victim)).status_code == 403
    assert client.get("/api/business/{}/manifest".format(victim)).status_code == 403
    assert client.put("/api/business/{}/section/1".format(victim),
                      json={"data": {"name": "Hijacked"}}).status_code == 403
    assert client.post("/api/business/{}/activate".format(victim)).status_code == 403
    assert client.delete("/api/business/{}".format(victim)).status_code == 403

    # ...and none of that touched it.
    sign_in(client, MERCHANT)
    assert client.get("/api/business/{}".format(victim)).status_code == 200


def test_a_merchant_cannot_vault_a_token_into_someone_elses_business(client, configured):
    sign_in(client, MERCHANT)
    victim = client.post("/api/businesses", json={"name": "Mine"}).json()["business"]["id"]
    sign_in(client, OTHER)
    response = client.post("/api/connect/shopify",
                           json={"subdomain": "x", "token": "shpat_fake",
                                 "business_id": victim})
    assert response.status_code == 403


def test_the_admin_console_is_closed_to_merchants(client, configured):
    sign_in(client, MERCHANT)
    assert client.get("/api/admin/merchants").status_code == 403
    sign_in(client, ADMIN)
    assert client.get("/api/admin/merchants").status_code == 200


def test_businesses_that_predate_sign_in_are_admin_only(client, configured):
    """An unowned row belongs to nobody, so no merchant may claim it by asking."""
    legacy = store.create_business(name="Legacy")
    assert store.owner_of(legacy) == ""

    sign_in(client, MERCHANT)
    assert client.get("/api/business/{}".format(legacy)).status_code == 403
    assert [b["id"] for b in client.get("/api/businesses").json()["businesses"]] == []

    sign_in(client, ADMIN)
    assert client.get("/api/business/{}".format(legacy)).status_code == 200


# --------------------------------------------------------------------------
# What comes back from Google
# --------------------------------------------------------------------------
def test_claims_are_accepted_when_they_are_ours(configured):
    profile = auth._claims_from_id_token(id_token())
    assert profile == {"email": MERCHANT, "name": "Shop Owner", "picture": ""}


def test_an_email_is_normalised_to_lowercase(configured):
    assert auth._claims_from_id_token(
        id_token(email="Shop@Example.COM"))["email"] == MERCHANT


@pytest.mark.parametrize("claims,expected", [
    ({"aud": "someone-elses-client"}, "different app"),
    ({"iss": "https://evil.example.com"}, "didn't come from Google"),
    ({"email": ""}, "no email address"),
    ({"email_verified": False}, "verify your email"),
])
def test_claims_that_are_not_ours_are_refused(configured, claims, expected):
    with pytest.raises(auth.AuthError, match=expected):
        auth._claims_from_id_token(id_token(**claims))


# --------------------------------------------------------------------------
# The callback's own defences
# --------------------------------------------------------------------------
def test_state_must_be_signed_by_us(configured):
    with pytest.raises(auth.AuthError, match="couldn't verify"):
        auth.read_state("not-a-real-state", "nonce")


def test_state_must_pair_with_this_browsers_nonce(client, configured):
    """The signature proves it came from us; the nonce proves it came from here."""
    response = client.get("/api/auth/login", follow_redirects=False)
    state = response.headers["location"].split("state=")[1].split("&")[0]
    import urllib.parse
    state = urllib.parse.unquote(state)
    with pytest.raises(auth.AuthError, match="didn't start in this browser"):
        auth.read_state(state, "a-different-browsers-nonce")


def test_the_return_path_can_never_leave_this_site(configured):
    for hostile in ("https://evil.example.com", "//evil.example.com", "", None):
        assert auth._safe_next(hostile) == "/"
    assert auth._safe_next("/business/ravi-electronics") == "/business/ravi-electronics"


# --------------------------------------------------------------------------
# Where local credentials come from
# --------------------------------------------------------------------------
@pytest.fixture()
def pristine_env():
    """Undo whatever `envfile.load` writes into the real process environment.

    monkeypatch cannot do this for us: `delenv(..., raising=False)` on a name
    that was never set records nothing to restore, so a value the loader adds
    afterwards outlives the test. One leaked GOOGLE_CLIENT_SECRET is enough to
    switch sign-in on for every test that runs later, which reads as a pile of
    unrelated 401s in another file.
    """
    saved = dict(os.environ)
    yield
    os.environ.clear()
    os.environ.update(saved)


def test_env_file_supplies_missing_values(tmp_path, monkeypatch, pristine_env):
    path = tmp_path / ".env"
    path.write_text(
        "# a comment\n"
        "\n"
        "GOOGLE_CLIENT_ID=from-the-file\n"
        "export GOOGLE_CLIENT_SECRET='GOCSPX-quoted'\n"
        "SARVAM_API_KEY = spaced-out \n"
        "not-a-pair\n")
    for name in ("GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "SARVAM_API_KEY"):
        monkeypatch.delenv(name, raising=False)

    applied = envfile.load(str(path))

    assert set(applied) == {"GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "SARVAM_API_KEY"}
    assert os.environ["GOOGLE_CLIENT_ID"] == "from-the-file"
    # Quotes are decoration in a .env and a 403 when forwarded to an API.
    assert os.environ["GOOGLE_CLIENT_SECRET"] == "GOCSPX-quoted"
    assert os.environ["SARVAM_API_KEY"] == "spaced-out"


def test_a_real_environment_variable_always_wins(tmp_path, monkeypatch, pristine_env):
    """A host sets real variables; .env must never be able to override them."""
    path = tmp_path / ".env"
    path.write_text("GOOGLE_CLIENT_ID=from-the-file\n")
    monkeypatch.setenv("GOOGLE_CLIENT_ID", "from-the-host")

    assert envfile.load(str(path)) == []
    assert os.environ["GOOGLE_CLIENT_ID"] == "from-the-host"


def test_a_missing_env_file_is_not_an_error(tmp_path):
    assert envfile.load(str(tmp_path / "nothing-here")) == []


def test_a_failed_callback_sends_the_human_back_to_a_readable_message(client, configured):
    response = client.get("/api/auth/callback?error=access_denied",
                          follow_redirects=False)
    assert response.status_code == 302
    assert response.headers["location"] == "/?auth_error=Sign-in%20was%20cancelled."
