"""Gate B7 -- the knowledge-base scraper.

Run from the repo root:  ./venv/bin/python -m pytest tests/backend -v

Everything here is offline. The one test that touches the network is skipped
unless UCXP_LIVE_SCRAPE is set, because the five demo stores are password-gated
and cannot serve as fixtures.
"""

import asyncio
import json
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from Dashboard.backend import scraper, store  # noqa: E402


@pytest.fixture()
def client(tmp_path):
    """A TestClient backed by a throwaway database."""
    store.set_db_path(str(tmp_path / "test.db"))
    from fastapi.testclient import TestClient
    from Dashboard.backend.main import app
    with TestClient(app) as test_client:
        yield test_client
    store.set_db_path(os.environ.get("UCXP_DB", store.DEFAULT_DB))


# --------------------------------------------------------------------------
# URL hygiene
# --------------------------------------------------------------------------
def test_bare_host_gets_https():
    assert scraper.normalise_url("ravielectronics.in/help") == \
        "https://ravielectronics.in/help"


@pytest.mark.parametrize("bad", [
    "", "   ", "ftp://example.com", "file:///etc/passwd",
    "http://user:pass@evil.com/", "localhost", "http://foo",
    "https://example.com:8000/x",
])
def test_unusable_urls_are_refused(bad):
    with pytest.raises(scraper.Blocked):
        scraper.normalise_url(bad)


# --------------------------------------------------------------------------
# SSRF -- the merchant controls this string, so it is attacker input
# --------------------------------------------------------------------------
@pytest.mark.parametrize("host", [
    "127.0.0.1", "localhost", "10.0.0.1", "192.168.1.1", "172.16.0.1",
    "169.254.169.254",          # cloud instance metadata
    "::1", "0.0.0.0",
])
def test_private_hosts_are_blocked(host):
    with pytest.raises(scraper.Blocked):
        scraper.assert_public_host(host)


def test_block_message_never_leaks_the_resolved_address():
    """A friendly error must not turn this endpoint into a port scanner."""
    try:
        scraper.assert_public_host("169.254.169.254")
    except scraper.Blocked as exc:
        assert "169.254" not in str(exc), "the resolved address leaked to the client"


def test_public_host_passes(monkeypatch):
    monkeypatch.setattr(
        scraper.socket, "getaddrinfo",
        lambda *a, **k: [(2, 1, 6, "", ("93.184.216.34", 0))],
    )
    assert scraper.assert_public_host("example.com") is True


def test_dns_failure_is_friendly(monkeypatch):
    def boom(*a, **k):
        raise scraper.socket.gaierror("nope")
    monkeypatch.setattr(scraper.socket, "getaddrinfo", boom)
    with pytest.raises(scraper.Blocked) as caught:
        scraper.assert_public_host("no-such-host.example")
    assert "couldn't find" in str(caught.value).lower()


# --------------------------------------------------------------------------
# Text extraction -- stdlib only, no bs4/lxml in this venv
# --------------------------------------------------------------------------
def test_scripts_and_styles_never_reach_the_model():
    html = ("<html><head><style>.a{color:red}</style></head><body>"
            "<script>window.track('x')</script><nav>Home Shop</nav>"
            "<main><p>Refunds take 5-7 business days.</p></main></body></html>")
    text = scraper.extract_text(html)
    assert "Refunds take 5-7 business days." in text
    assert "window.track" not in text and "color:red" not in text


def test_shopify_policy_body_is_preferred():
    body = "Our refund policy. " * 40
    html = ('<html><body><nav>menu</nav>'
            '<div class="shopify-policy__body"><p>{}</p></div></div>'
            '</body></html>').format(body)
    assert "Our refund policy." in scraper.extract_text(html)


def test_js_shell_yields_nothing():
    html = '<html><body><div id="root"></div><script>boot()</script></body></html>'
    assert len(scraper.extract_text(html)) < scraper.MIN_TEXT_CHARS


def test_jsonld_faqs_are_read_without_the_model():
    payload = {
        "@type": "FAQPage",
        "mainEntity": [{
            "@type": "Question", "name": "Do you deliver to Warangal?",
            "acceptedAnswer": {"@type": "Answer", "text": "Yes, in 3-4 days."},
        }],
    }
    html = '<script type="application/ld+json">{}</script>'.format(json.dumps(payload))
    found = scraper.faqs_from_jsonld(html)
    assert found == [{"q": "Do you deliver to Warangal?", "a": "Yes, in 3-4 days."}]


def test_malformed_jsonld_is_ignored():
    html = '<script type="application/ld+json">{not json,,}</script>'
    assert scraper.faqs_from_jsonld(html) == []


# --------------------------------------------------------------------------
# Candidates
# --------------------------------------------------------------------------
def test_storefront_policy_paths_are_tried():
    urls = scraper.candidate_urls("https://shop.example.in/help")
    assert urls[0] == "https://shop.example.in/help", "merchant's own URL comes first"
    assert "https://shop.example.in/policies/refund-policy" in urls
    assert len(urls) <= scraper.MAX_PAGES


def test_robots_disallow_is_honoured():
    import urllib.robotparser
    robots = urllib.robotparser.RobotFileParser()
    robots.parse(["User-agent: *", "Disallow: /policies/"])
    urls = scraper.candidate_urls("https://shop.example.in/", robots=robots)
    assert not any("/policies/" in u for u in urls)


# --------------------------------------------------------------------------
# Dedupe -- a half-filled FAQ would knock Section 5 from "done" back to "part"
# --------------------------------------------------------------------------
def test_blank_sided_faqs_are_dropped():
    rows = [{"q": "A", "a": ""}, {"q": "", "a": "B"}, {"q": "C", "a": "D"}]
    assert scraper.dedupe_faqs(rows) == [{"q": "C", "a": "D", "draft": True}]


def test_dedupe_is_case_and_space_insensitive():
    rows = [{"q": "Do you ship?", "a": "Yes"}, {"q": "  do you SHIP? ", "a": "Yes"}]
    assert len(scraper.dedupe_faqs(rows)) == 1


def test_questions_the_merchant_already_has_are_skipped():
    rows = [{"q": "Do you ship?", "a": "Yes"}, {"q": "Refund window?", "a": "7 days"}]
    kept = scraper.dedupe_faqs(rows, existing_questions=["do you ship?"])
    assert [row["q"] for row in kept] == ["Refund window?"]


def test_imports_are_capped_and_marked_draft():
    rows = [{"q": "Q{}".format(i), "a": "A"} for i in range(30)]
    kept = scraper.dedupe_faqs(rows)
    assert len(kept) == scraper.MAX_FAQS
    assert all(row["draft"] is True for row in kept)


# --------------------------------------------------------------------------
# Sarvam -- a truncated answer is discarded, never repaired
# --------------------------------------------------------------------------
class _FakeResponse:
    def __init__(self, payload, status=200):
        self._payload = payload
        self.status_code = status
        self.text = json.dumps(payload)

    def json(self):
        return self._payload


class _FakeClient:
    def __init__(self, payload, status=200):
        self._payload, self._status = payload, status
        self.calls = 0

    async def post(self, *a, **k):
        self.calls += 1
        return _FakeResponse(self._payload, self._status)


def _call(client):
    return asyncio.run(scraper.sarvam_json(
        client, "sys", "text", scraper.FAQ_SCHEMA, "merchant_faqs"))


def test_truncated_response_is_discarded(monkeypatch):
    """finish_reason 'length' means the JSON is cut off mid-object.

    Repairing it, or reading reasoning_content instead, would invent merchant
    policy out of the model's chain of thought.
    """
    monkeypatch.setenv("SARVAM_API_KEY", "test-key")
    fake = _FakeClient({"choices": [{
        "finish_reason": "length",
        "message": {"content": '{"faqs": [{"q": "Do you shi',
                    "reasoning_content": "I should list the FAQs..."},
    }]})
    assert _call(fake) is None


def test_good_response_parses(monkeypatch):
    monkeypatch.setenv("SARVAM_API_KEY", "test-key")
    fake = _FakeClient({"choices": [{
        "finish_reason": "stop",
        "message": {"content": '{"faqs": [{"q": "Ship?", "a": "Yes"}]}'},
    }]})
    assert _call(fake) == {"faqs": [{"q": "Ship?", "a": "Yes"}]}


def test_bad_request_is_not_retried(monkeypatch):
    """A schema or budget rejection fails identically every time."""
    monkeypatch.setenv("SARVAM_API_KEY", "test-key")
    fake = _FakeClient({"error": {"message": "max_tokens exceeds"}}, status=400)
    assert _call(fake) is None
    assert fake.calls == 1, "a 400 must not be retried"


def test_missing_key_is_reported_not_crashed(monkeypatch):
    monkeypatch.setenv("SARVAM_API_KEY", "")
    monkeypatch.setattr(scraper, "_api_key", lambda: "")
    with pytest.raises(scraper.Blocked):
        _call(_FakeClient({}))


# --------------------------------------------------------------------------
# HTTP contract
# --------------------------------------------------------------------------
def test_b7_bad_url_is_a_friendly_200(client):
    """Gate F8 fills 'not-a-url' and asserts an inline message, not an error screen."""
    response = client.post("/api/scrape-faq", json={"url": "not-a-url"})
    assert response.status_code == 200
    body = response.json()
    assert body["ok"] is False
    assert "https://" in body["error"]


def test_b7_loopback_target_is_refused_and_returns_no_content(client):
    """The regression test for a readable SSRF: the dashboard must not fetch itself."""
    response = client.post(
        "/api/scrape-faq", json={"url": "http://127.0.0.1:8000/api/businesses"})
    assert response.status_code == 200
    body = response.json()
    assert body["ok"] is False
    assert "businesses" not in response.text.lower() or "business_id" not in response.text


def test_b7_scrape_failure_never_leaks_a_trace(client, monkeypatch):
    async def boom(*a, **k):
        raise RuntimeError("internal detail nobody should see")
    monkeypatch.setattr(scraper, "scrape", boom)
    response = client.post("/api/scrape-faq", json={"url": "https://example.in"})
    assert response.status_code == 200
    assert response.json()["ok"] is False
    assert "Traceback" not in response.text
    assert "internal detail" not in response.text


def test_b7_happy_path_shape(client, monkeypatch):
    async def fake(url, existing=()):
        return {"ok": True, "source": url,
                "faqs": [{"q": "Ship?", "a": "Yes", "draft": True}],
                "policies": {k: "" for k in scraper.POLICY_KEYS},
                "pages_read": [url], "notes": ""}
    monkeypatch.setattr(scraper, "scrape", fake)
    body = client.post("/api/scrape-faq", json={"url": "https://example.in"}).json()
    assert body["ok"] is True
    assert all(row["draft"] is True for row in body["faqs"])
    assert set(body["policies"]) == set(scraper.POLICY_KEYS)


def test_b7_connect_custom_also_refuses_private_hosts(client):
    """The same SSRF guard now covers the older endpoint that had none."""
    body = client.post(
        "/api/connect/custom",
        json={"base_url": "http://169.254.169.254/latest/meta-data/"}).json()
    assert body["ok"] is False
    assert body["reachable"] is False


# --------------------------------------------------------------------------
# Live -- opt in, and never against the password-gated demo stores
# --------------------------------------------------------------------------
@pytest.mark.skipif(not os.environ.get("UCXP_LIVE_SCRAPE"),
                    reason="set UCXP_LIVE_SCRAPE=1 to hit the network")
def test_b7_live_public_store():
    result = asyncio.run(scraper.scrape("https://bombayshavingcompany.com"))
    assert result["ok"] is True
    assert result["faqs"] or any(result["policies"].values())


def test_quoted_env_key_is_unwrapped(monkeypatch):
    """A key copied out of a .env file arrives wrapped in quotes.

    Sent verbatim it is a 403, which surfaces as "not configured" and sends you
    hunting for a variable that is in fact set.
    """
    for raw in ("'sk_abc123'", '"sk_abc123"', "  sk_abc123  ", "sk_abc123"):
        monkeypatch.setenv("SARVAM_API_KEY", raw)
        assert scraper._api_key() == "sk_abc123", "did not unwrap {!r}".format(raw)


def test_a_refused_landing_page_does_not_abandon_the_site(monkeypatch):
    """Storefronts guard / but leave /policies/* open for search engines.

    Giving up on the first miss loses the pages actually worth reading.
    """
    fetched = []

    async def fake_fetch(urls):
        fetched.extend(urls)
        # The landing page is refused; a policy page answers.
        return {u: {"html": "<main>" + ("Refunds take 7 days. " * 40) + "</main>",
                    "final_url": u, "status": 200}
                for u in urls if "/policies/" in u}

    async def no_llm(*a, **k):
        return None

    monkeypatch.setattr(scraper, "fetch_pages", fake_fetch)
    monkeypatch.setattr(scraper, "sarvam_json", no_llm)
    monkeypatch.setenv("SARVAM_API_KEY", "test-key")
    monkeypatch.setattr(scraper, "assert_public_host", lambda host: True)

    result = asyncio.run(scraper.scrape("https://shop.example.in/"))
    assert result["ok"] is True
    assert result["pages_read"], "policy pages should still have been read"
    assert any("/policies/" in u for u in fetched)


def test_a_wholly_unreachable_site_is_still_reported(monkeypatch):
    async def nothing(urls):
        return {}
    monkeypatch.setattr(scraper, "fetch_pages", nothing)
    monkeypatch.setattr(scraper, "assert_public_host", lambda host: True)
    with pytest.raises(scraper.Blocked) as caught:
        asyncio.run(scraper.scrape("https://shop.example.in/"))
    assert "blocking automated readers" in str(caught.value)
