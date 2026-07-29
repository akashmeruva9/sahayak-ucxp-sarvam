"""Voice onboarding: what it fills in, and what it refuses to invent.

The rule these tests exist to hold is that a merchant may end up typing a field
we could not hear, but must never end up shipping one we made up.
"""

import asyncio
import json
import os
import sys

import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

from Dashboard.backend import voice  # noqa: E402
from Dashboard.backend.scraper import Blocked  # noqa: E402


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
        self.last = {}

    async def post(self, url, **kwargs):
        self.calls += 1
        self.last = dict(kwargs, url=url)
        return _FakeResponse(self._payload, self._status)


@pytest.fixture(autouse=True)
def _key(monkeypatch):
    monkeypatch.setattr(voice, "_api_key", lambda: "test-key")


# --------------------------------------------------------------------------
# Transcription
# --------------------------------------------------------------------------
def test_autodetect_is_requested_not_a_fixed_language():
    """Not knowing what the merchant speaks is the point of the feature."""
    fake = _FakeClient({"transcript": "Hello", "language_code": "te-IN"})
    asyncio.run(voice.transcribe(fake, b"x" * 1000))

    assert fake.last["data"]["language_code"] == voice.STT_AUTODETECT
    assert fake.last["data"]["mode"] == "translate", "we need English back"
    assert fake.last["data"]["model"] == "saaras:v3"


def test_transcript_and_detected_language_come_back():
    fake = _FakeClient({"transcript": "  I sell headphones  ",
                        "language_code": "te-IN"})
    text, lang = asyncio.run(voice.transcribe(fake, b"x" * 1000))
    assert text == "I sell headphones"
    assert lang == "te-IN"


def test_silence_is_empty_not_an_error():
    fake = _FakeClient({"transcript": "", "language_code": None})
    assert asyncio.run(voice.transcribe(fake, b"x" * 1000)) == ("", "")


def test_a_bad_key_is_a_403_and_is_not_retried():
    """Sarvam answers a bad key with 403, not 401. Retrying it is pointless."""
    fake = _FakeClient({"error": "forbidden"}, status=403)
    with pytest.raises(Blocked):
        asyncio.run(voice.transcribe(fake, b"x" * 1000))
    assert fake.calls == 1


# --------------------------------------------------------------------------
# Extraction
# --------------------------------------------------------------------------
def _extract(payload, status=200):
    fake = _FakeClient(payload, status)
    return asyncio.run(voice.extract(fake, "text")), fake


def test_extraction_runs_on_the_smaller_model():
    """Eight fields from two sentences is not flagship work, and the merchant
    is watching a spinner while it happens."""
    assert voice.CHAT_MODEL == "sarvam-30b", "the default stays the fast one"
    _, fake = _extract({"choices": [{"finish_reason": "stop",
                                     "message": {"content": "{}"}}]})
    assert fake.last["json"]["model"] == voice.CHAT_MODEL


def test_the_model_can_be_switched_without_a_deploy(monkeypatch):
    """Tier availability varies; UCXP_VOICE_MODEL is the escape hatch."""
    monkeypatch.setattr(voice, "CHAT_MODEL", "sarvam-105b")
    _, fake = _extract({"choices": [{"finish_reason": "stop",
                                     "message": {"content": "{}"}}]})
    assert fake.last["json"]["model"] == "sarvam-105b"


def test_a_truncated_answer_is_discarded_not_repaired():
    result, _ = _extract({"choices": [{
        "finish_reason": "length",
        "message": {"content": '{"name": "Ravi Elect',
                    "reasoning_content": "The shop seems to be..."},
    }]})
    assert result is None


def test_a_400_is_not_retried():
    result, fake = _extract({"error": {"message": "schema"}}, status=400)
    assert result is None
    assert fake.calls == 1


# --------------------------------------------------------------------------
# Cleaning -- the guard against a confident invention
# --------------------------------------------------------------------------
def test_blank_fields_are_dropped_so_the_form_stays_empty():
    fields = voice.clean(
        {"name": "Ravi Electronics", "city": "  ", "tagline": "", "hours": None},
        "te-IN")
    assert fields["name"] == "Ravi Electronics"
    assert "city" not in fields and "tagline" not in fields and "hours" not in fields


def test_a_spoken_email_that_is_not_an_address_is_dropped():
    """"support at the rate of gmail.com" came back as a bare "gmail.com".

    Support email is required to activate, so a non-address is worse than a
    blank: it looks filled in and never gets a second look.
    """
    assert "email" not in voice.clean({"email": "gmail.com"}, "")
    assert "email" not in voice.clean({"email": "siri pharma at gmail"}, "")
    assert voice.clean({"email": "siri@pharma.com"}, "")["email"] == "siri@pharma.com"


def test_the_token_budget_leaves_room_for_reasoning():
    """Reasoning is billed as output and spent before any content appears; a
    real answer used 1,855 of 2,048. 4096 is the starter-tier ceiling."""
    assert voice.CHAT_MAX_TOKENS == 4096


def test_a_category_outside_the_vocabulary_is_refused():
    assert "category" not in voice.clean({"category": "Spaceships"}, "")
    assert voice.clean({"category": "Electronics"}, "")["category"] == "Electronics"


def test_an_unknown_language_code_is_refused():
    fields = voice.clean({"languages": ["te", "klingon", "hi"]}, "")
    assert fields["languages"] == ["te", "hi"]


def test_the_spoken_language_is_added_and_leads():
    """They spoke Telugu; Telugu should be on even if they only listed Hindi."""
    assert voice.clean({"languages": ["hi"]}, "te-IN")["languages"] == ["te", "hi"]


def test_the_spoken_language_is_not_duplicated():
    assert voice.clean({"languages": ["te", "hi"]}, "te-IN")["languages"] == ["te", "hi"]


def test_odia_is_matched_on_sarvams_spelling():
    """Saaras reports od-IN. Our internal code is the ISO 'or'."""
    assert voice.clean({"languages": []}, "od-IN")["languages"] == ["or"]


def test_nothing_heard_yields_no_fields_rather_than_defaults():
    assert voice.clean({}, "") == {}
    assert voice.clean(None, "") == {}


# --------------------------------------------------------------------------
# The whole path -- it must never block onboarding
# --------------------------------------------------------------------------
def test_a_recording_too_short_to_hear_is_a_friendly_200():
    result = asyncio.run(voice.onboard(b"tiny"))
    assert result["ok"] is False
    assert result["fields"] == {}
    assert "hold the button" in result["error"].lower()


def test_an_oversized_recording_is_refused_before_it_is_uploaded():
    result = asyncio.run(voice.onboard(b"x" * (voice.MAX_AUDIO_BYTES + 1)))
    assert result["ok"] is False
    assert "too long" in result["error"].lower()


def test_when_the_model_fails_the_transcript_is_still_returned(monkeypatch):
    """We heard them. That is worth handing back even if the form stays empty."""
    async def heard(client, audio, filename=None, content_type=None):
        return "I sell headphones in Warangal", "te-IN"

    async def failed(client, text):
        return None

    monkeypatch.setattr(voice, "transcribe", heard)
    monkeypatch.setattr(voice, "extract", failed)

    result = asyncio.run(voice.onboard(b"x" * 1000))
    assert result["ok"] is False
    assert result["heard"] == "I sell headphones in Warangal"
    assert result["language"] == "te-IN"


def test_the_happy_path(monkeypatch):
    async def heard(client, audio, filename=None, content_type=None):
        return ("My name is Ravi. I have an electronics shop in Warangal. "
                "I sell headphones and chargers."), "te-IN"

    async def structured(client, text):
        return {"name": "Ravi Electronics", "category": "Electronics",
                "city": "Warangal", "description": "Headphones and chargers",
                "tagline": "", "hours": "", "email": "", "phone": "",
                "languages": ["te", "hi"]}

    monkeypatch.setattr(voice, "transcribe", heard)
    monkeypatch.setattr(voice, "extract", structured)

    result = asyncio.run(voice.onboard(b"x" * 1000))
    assert result["ok"] is True
    assert result["fields"]["name"] == "Ravi Electronics"
    assert result["fields"]["city"] == "Warangal"
    assert result["fields"]["languages"] == ["te", "hi"]
    assert "tagline" not in result["fields"], "a blank field is left blank"


# --------------------------------------------------------------------------
# The endpoint
# --------------------------------------------------------------------------
@pytest.fixture
def client(tmp_path):
    from Dashboard.backend import store
    store.set_db_path(str(tmp_path / "test.db"))
    from fastapi.testclient import TestClient
    from Dashboard.backend.main import app
    with TestClient(app) as test_client:
        yield test_client
    store.set_db_path(os.environ.get("UCXP_DB", store.DEFAULT_DB))


def _post(client, blob=b"tiny"):
    return client.post("/api/voice-onboard",
                       files={"audio": ("speech.webm", blob, "audio/webm")})


def test_the_endpoint_never_answers_with_a_500(client):
    """The form underneath is always typeable, so a failure here is a 200."""
    response = _post(client)
    assert response.status_code == 200
    body = response.json()
    assert body["ok"] is False
    assert body["fields"] == {}
    assert body["error"]


def test_an_unconfigured_server_says_so_plainly(client, monkeypatch):
    monkeypatch.setattr(voice, "_api_key", lambda: "")
    response = _post(client, b"x" * 1000)
    assert response.status_code == 200
    assert response.json()["ok"] is False
    assert "isn't configured" in response.json()["error"]


def test_the_endpoint_shape_is_stable_on_every_path(client):
    """The frontend reads these four keys unconditionally."""
    body = _post(client).json()
    assert set(body) == {"ok", "fields", "heard", "language", "error"}
