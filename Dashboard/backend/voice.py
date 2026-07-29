"""Fills the onboarding form from one spoken sentence.

A merchant who needs a Telugu-speaking assistant should not have to complete an
English form to get one. This module lets them hold a button, say what their
shop is, and find Section 1 and Section 4 already filled in.

Three decisions shape everything here.

**One utterance, not a conversation.** We ask a single open question and pull
every field we can out of the answer. A nine-question spoken interview would
mean nine round trips at several seconds each, plus a dialogue state machine to
debug. Instead: voice fills, and the form -- which already exists, and which the
merchant can see -- corrects. Partial extraction is therefore harmless; a field
we could not hear simply stays blank.

**Saaras translates, so the reasoning happens in English.** ``mode="translate"``
returns English text and the detected source language in one call, which
collapses what would otherwise be transcribe-then-translate, and hands the
extraction model the language it is strongest in. We keep the detected code
because that is what pre-selects Section 4 -- a merchant who speaks Telugu to us
almost certainly wants Telugu on.

**Extraction runs on sarvam-30b, not 105b.** Pulling eight fields out of two
sentences is not flagship work, and onboarding is the one place in the product
where latency is visible to the person waiting. 105b stays where it earns its
keep, reading whole web pages in ``scraper.py``.

Like the scraper, nothing here may block onboarding: every outcome that is not a
programming error comes back as a 200 the merchant can act on, because the form
underneath is always still typeable by hand.
"""

import asyncio
import json
import logging
import os
import re

import httpx

from .constants import CATEGORIES, LANGUAGE_CODES, to_bcp47
from .scraper import Blocked, _api_key

log = logging.getLogger("ucxp.voice")

STT_URL = "https://api.sarvam.ai/speech-to-text"
STT_MODEL = "saaras:v3"
# `translate` is the mode that returns English plus the detected source language.
STT_MODE = "translate"
# "unknown" is Saaras's autodetect sentinel. We must not pass a language here:
# not knowing what the merchant speaks is the entire point of the feature.
STT_AUTODETECT = "unknown"

CHAT_URL = "https://api.sarvam.ai/v1/chat/completions"
# Overridable because model availability varies by tier, and a model this
# account cannot call answers 400 -- which reads to the merchant as "we couldn't
# fill the form from that" rather than as a configuration problem. Setting
# UCXP_VOICE_MODEL=sarvam-105b is then a variable change, not a deploy.
CHAT_MODEL = (os.environ.get("UCXP_VOICE_MODEL") or "sarvam-30b").strip()
# Reasoning cannot be switched off and is billed as output, so it is spent
# before any content appears -- a real answer measured 1,855 completion tokens
# against a 2,048 ceiling, i.e. it fit by 193. Anything the merchant said that
# was slightly longer truncated, and a truncated structured response is
# discarded rather than repaired, so it reached them as "we couldn't fill the
# form from it". 4096 is the starter-tier ceiling; 8000 is a 400, not a slower
# request, so this is as much headroom as there is to take.
CHAT_MAX_TOKENS = 4096

# A spoken sentence is short, so both calls are quick. The ceiling exists to stop
# a hung socket holding a worker, not because we expect to approach it.
TIMEOUT_S = 45.0
TOTAL_BUDGET_S = 90.0

# Sarvam accepts WebM, which is what MediaRecorder produces in Chrome and
# Firefox, so the browser's own recording uploads without transcoding. Safari
# emits MP4/AAC, also accepted. The cap is a guard against a stuck recorder
# uploading a hundred megabytes, not a limit a real answer will meet.
MAX_AUDIO_BYTES = 12 * 1024 * 1024
MIN_AUDIO_BYTES = 512

# Matches S1BusinessProfile.jsx, so voice cannot fill a value the form would
# immediately flag back at the merchant as invalid.
EMAIL_RE = re.compile(r"^\S+@\S+\.\S+$")

# Every field is required so the schema can stay strict; the model returns "" for
# anything it did not hear. An empty field is a correct answer here -- it leaves
# the merchant typing one box rather than correcting an invented one.
ONBOARD_SCHEMA = {
    "type": "object",
    "properties": {
        "name": {"type": "string"},
        "tagline": {"type": "string"},
        "description": {"type": "string"},
        "category": {"type": "string", "enum": list(CATEGORIES) + [""]},
        "city": {"type": "string"},
        "hours": {"type": "string"},
        "email": {"type": "string"},
        "phone": {"type": "string"},
        "languages": {
            "type": "array",
            "items": {"type": "string", "enum": list(LANGUAGE_CODES)},
        },
    },
    "required": ["name", "tagline", "description", "category", "city",
                 "hours", "email", "phone", "languages"],
    "additionalProperties": False,
}

ONBOARD_SYSTEM = (
    "A shopkeeper has been asked to describe their business out loud. You are "
    "reading an English translation of what they said, and filling in a form.\n"
    "\n"
    "Use ONLY what the speaker actually said. Never invent a name, a city, a "
    "phone number or an opening time, and never guess a category from the city "
    "or the shop's name alone -- guess only from goods or services they "
    "mention. If they did not say something, return an empty string for it. An "
    "empty field is correct; a plausible invention is not, because the merchant "
    "may not notice it before it reaches their customers.\n"
    "\n"
    "Field meanings:\n"
    "- name: the trading name of the shop, in title case. Not the owner's own "
    "name, unless the shop is plainly named after them.\n"
    "- tagline: a short phrase of at most 8 words, ONLY if the speaker offered "
    "one. Do not compose marketing copy.\n"
    "- description: at most 25 words on what they sell, in the shop's voice.\n"
    "- category: exactly one of the listed values, or \"\" if none clearly fits.\n"
    "- city: the town or city, without the state.\n"
    "- hours: normalise to a 12-hour range like \"10:00 AM - 9:00 PM\". "
    "Include closing days only if mentioned.\n"
    "- email: assemble the address the speaker dictated. Both \"at\" and \"at the "
    "rate of\" mean @; \"dot\" means a full stop; \"underscore\" means _; "
    "\"hyphen\" and \"dash\" mean -. Remove every space and lowercase the "
    "result. So \"manideep dot karalapati at the rate of gmail dot com\" is "
    "manideep.karalapati@gmail.com, and \"siripharma at gmail.com\" is "
    "siripharma@gmail.com. Return \"\" unless you can build a complete address "
    "with exactly one @ and a domain containing a dot -- a fragment like "
    "\"gmail.com\" on its own is not an address.\n"
    "- phone: only if spoken aloud, digit for digit.\n"
    "- languages: BCP-47 prefixes of every language the speaker says they serve "
    "customers in. Add the language they are speaking themselves. Use only the "
    "listed codes."
)


def _friendly(message):
    """Every failure the merchant sees is one sentence and a way forward."""
    return {"ok": False, "error": message, "fields": {}, "heard": "", "language": ""}


async def transcribe(client, audio, filename="speech.webm", content_type=None):
    """Spoken audio -> (English text, detected BCP-47 code).

    Returns ("", "") when Saaras answers but has nothing to give us, which is
    what silence and a muffled microphone both look like.
    """
    key = _api_key()
    if not key:
        raise Blocked("Voice onboarding isn't configured on this server.")

    files = {"file": (filename, audio, content_type or "application/octet-stream")}
    data = {"model": STT_MODEL, "mode": STT_MODE, "language_code": STT_AUTODETECT}

    last = ""
    for attempt in range(3):
        try:
            response = await client.post(
                STT_URL, files=files, data=data,
                headers={"api-subscription-key": key}, timeout=TIMEOUT_S,
            )
        except Exception as exc:                                   # noqa: BLE001
            last = type(exc).__name__
            await asyncio.sleep(2 * (attempt + 1))
            continue

        # A bad key is a 403 here, not a 401 -- retrying it would just burn the
        # merchant's patience against a wall.
        if response.status_code in (401, 403):
            raise Blocked("Voice onboarding isn't configured on this server.")
        if response.status_code == 400:
            log.error("voice.stt_rejected body=%s", response.text[:400])
            return "", ""
        if response.status_code == 429 or response.status_code >= 500:
            last = "HTTP {}".format(response.status_code)
            await asyncio.sleep(2 * (attempt + 1))
            continue

        body = response.json()
        return (body.get("transcript") or "").strip(), (body.get("language_code") or "")

    log.info("voice.stt_unreachable last=%s", last)
    raise Blocked("We couldn't reach the speech service just now. Please type "
                  "your details in below.")


async def extract(client, text):
    """English text -> the Section 1 and Section 4 fields it contains.

    Returns None when the model could not finish. A truncated structured
    response is discarded rather than repaired: half a JSON object rebuilt by
    hand is how a merchant ends up with a city they never said.
    """
    key = _api_key()
    if not key:
        raise Blocked("Voice onboarding isn't configured on this server.")

    payload = {
        "model": CHAT_MODEL,
        "messages": [
            {"role": "system", "content": ONBOARD_SYSTEM},
            {"role": "user", "content": text},
        ],
        "temperature": 0.1,
        "max_tokens": CHAT_MAX_TOKENS,
        "reasoning_effort": "low",
        "response_format": {
            "type": "json_schema",
            "json_schema": {"name": "merchant_profile", "schema": ONBOARD_SCHEMA,
                            "strict": True},
        },
    }

    last = ""
    for attempt in range(3):
        try:
            response = await client.post(
                CHAT_URL, json=payload,
                headers={"api-subscription-key": key,
                         "Content-Type": "application/json"},
                timeout=TIMEOUT_S,
            )
        except Exception as exc:                                   # noqa: BLE001
            last = type(exc).__name__
            await asyncio.sleep(2 * (attempt + 1))
            continue

        if response.status_code in (401, 403):
            raise Blocked("Voice onboarding isn't configured on this server.")
        if response.status_code == 400:
            log.error("voice.chat_rejected body=%s", response.text[:400])
            return None
        if response.status_code == 429 or response.status_code >= 500:
            last = "HTTP {}".format(response.status_code)
            await asyncio.sleep(2 * (attempt + 1))
            continue

        choice = (response.json().get("choices") or [{}])[0]
        if choice.get("finish_reason") == "length":
            log.info("voice.chat_truncated")
            return None
        content = (choice.get("message") or {}).get("content") or ""
        try:
            return json.loads(content)
        except (ValueError, TypeError):
            log.info("voice.chat_unparseable")
            return None

    log.info("voice.chat_unreachable last=%s", last)
    return None


def clean(raw, detected):
    """Keep only fields we can defend, and fold the spoken language in.

    The model is constrained by the schema, but a constrained model is not a
    trusted one: anything unexpected is dropped rather than passed through to a
    form the merchant may accept without reading.
    """
    raw = raw if isinstance(raw, dict) else {}
    fields = {}

    for key in ("name", "tagline", "description", "city", "hours", "email", "phone"):
        value = raw.get(key)
        if isinstance(value, str) and value.strip():
            fields[key] = value.strip()

    # Spoken email addresses arrive as "siri pharma at the rate of gmail dot com",
    # and the model reassembles them with mixed success -- one real answer gave
    # back a bare "gmail.com". Support email is required to activate, so a value
    # that is not an address is worse than none: it looks filled in, and the
    # merchant has no reason to look at it again.
    if "email" in fields and not EMAIL_RE.match(fields["email"]):
        log.info("voice.email_discarded")
        fields.pop("email")

    category = raw.get("category")
    if category in CATEGORIES:
        fields["category"] = category

    languages = [
        code for code in (raw.get("languages") or [])
        if isinstance(code, str) and code in LANGUAGE_CODES
    ]
    # The language they spoke to us in counts, whether or not they listed it.
    # `detected` is BCP-47 ("te-IN") and may carry Sarvam's `od` spelling of
    # Odia, so match on the emitted form rather than the bare prefix.
    for code in LANGUAGE_CODES:
        if detected and to_bcp47(code).lower() == detected.strip().lower():
            if code not in languages:
                languages.insert(0, code)
            break

    if languages:
        # Preserve first-mention order, drop repeats.
        fields["languages"] = list(dict.fromkeys(languages))

    return fields


async def onboard(audio, filename="speech.webm", content_type=None):
    """One recording -> the fields it contained. Never raises for bad input."""
    if len(audio) < MIN_AUDIO_BYTES:
        return _friendly("That recording was too short to hear. Hold the button "
                         "while you speak, then let go.")
    if len(audio) > MAX_AUDIO_BYTES:
        return _friendly("That recording is too long. Try again in a sentence "
                         "or two.")

    async with httpx.AsyncClient() as client:
        text, detected = await transcribe(client, audio, filename, content_type)
        if not text:
            return _friendly("We couldn't make out any speech in that. Try "
                             "again somewhere quieter, or type your details in "
                             "below.")

        raw = await extract(client, text)

    if raw is None:
        # We heard them; we simply could not structure it. Hand back the
        # transcript anyway -- it is worth something on its own.
        return {"ok": False, "fields": {}, "heard": text, "language": detected,
                "error": "We heard you, but couldn't fill the form from it. "
                         "Please check the details below."}

    return {"ok": True, "fields": clean(raw, detected), "heard": text,
            "language": detected, "error": ""}
