"""WhatsApp as a UCXP interface — PLAN.md §3, §6, §7 #10.

A **thin transport adapter**, nothing more. It turns an inbound WhatsApp message
(text, voice note, PDF, or image) into plain text and feeds it through the exact
same `runtime.run(...)` pipeline the mobile app uses, keyed on the sender's phone
number so memory ("Cancel it.") works with no repetition. It contains no
business logic and never touches Sarvam directly — only the runtime does.

Delivered over the Twilio WhatsApp sandbox: Twilio POSTs each message here as a
form-encoded webhook; we reply with TwiML. Inbound media is downloaded with the
Twilio credentials, then:
  • audio/*          → engine.transcribe  (the /voice path, minus the routing)
  • PDFs and images  → ``documents.extract`` (pypdf / Tesseract OCR), the same
                       module ``POST /document`` uses, so a file resolves the
                       same way here as it does in the app
Text replies are always sent; a spoken voice-note reply is attached when
UCXP_WHATSAPP_SPEAK=1 and ffmpeg is available to transcode WAV→MP3.
"""

from __future__ import annotations

import base64
import shutil
import subprocess
import uuid
from typing import Annotated, Any

import httpx
from fastapi import APIRouter, BackgroundTasks, Form, Request, Response
from loguru import logger

from ..config import get_settings
from ..documents import EMPTY_MESSAGES, extract

router = APIRouter(prefix="/whatsapp", tags=["whatsapp"])

#: Short-lived store for outbound voice-note audio, fetched by Twilio via
#: GET /whatsapp/media/{id}. Bounded so a long session can't grow unbounded.
_MEDIA: dict[str, tuple[bytes, str]] = {}
_MEDIA_ORDER: list[str] = []
_MEDIA_MAX = 64


def _get_runtime() -> Any:
    # Deferred import: main.py imports this router at load time, so importing
    # main here at module scope would be circular. get_runtime() is a singleton.
    from ..main import get_runtime

    return get_runtime()


def _stash_media(data: bytes, content_type: str) -> str:
    media_id = uuid.uuid4().hex
    _MEDIA[media_id] = (data, content_type)
    _MEDIA_ORDER.append(media_id)
    while len(_MEDIA_ORDER) > _MEDIA_MAX:
        _MEDIA.pop(_MEDIA_ORDER.pop(0), None)
    return media_id


async def _download(url: str) -> bytes:
    """Fetch inbound media. Twilio media URLs require HTTP basic auth."""
    settings = get_settings()
    auth = (settings.twilio_account_sid, settings.twilio_auth_token)
    async with httpx.AsyncClient(timeout=20.0, follow_redirects=True) as client:
        resp = await client.get(url, auth=auth)
        resp.raise_for_status()
        return resp.content


def _wav_to_mp3(wav: bytes) -> bytes | None:
    """Transcode so WhatsApp accepts the voice-note reply (it rejects WAV)."""
    if not shutil.which("ffmpeg"):
        return None
    try:
        proc = subprocess.run(
            ["ffmpeg", "-hide_banner", "-loglevel", "error", "-i", "pipe:0",
             "-f", "mp3", "-b:a", "64k", "pipe:1"],
            input=wav, capture_output=True, timeout=30, check=True,
        )
        return proc.stdout or None
    except Exception as exc:  # noqa: BLE001 — never let TTS transcode break a reply
        logger.warning(f"whatsapp.mp3_transcode_failed {exc}")
        return None


async def _resolve_input(
    body: str,
    num_media: int,
    media_url: str | None,
    media_type: str | None,
) -> tuple[str, str | None, str]:
    """Return (text, language_hint, kind). language_hint is set only for audio,
    where the engine detected it; text/documents let the runtime detect."""
    if num_media and media_url and media_type:
        kind = media_type.split("/")[0]
        data = await _download(media_url)

        if media_type.startswith("audio/"):
            speech = await _get_runtime().engine.transcribe(
                data, filename=f"voice.{media_type.split('/')[-1] or 'ogg'}"
            )
            if not speech.success:
                return ("", None, "audio_error")
            return (speech.transcript, speech.detected_language.value, "audio")

        # PDFs and images go through the shared extractor, so this channel and
        # the app resolve an identical document identically.
        result = extract(data, content_type=media_type, filename=None, caption=body)
        return (result.text, None, result.kind) if result.ok else ("", None, result.kind)

    return (body.strip(), None, "text")


_EMPTY_MESSAGES = {
    "audio_error": "I couldn't understand that voice note — could you try again or type it?",
    **EMPTY_MESSAGES,
}


def _twiml(text: str = "", media_url: str | None = None) -> Response:
    """Build a TwiML reply. Empty text ⇒ an empty <Response>, which tells Twilio
    'no synchronous reply' — we send the real answer out-of-band instead."""
    from twilio.twiml.messaging_response import MessagingResponse

    reply = MessagingResponse()
    if text:
        msg = reply.message(text)
        if media_url:
            msg.media(media_url)
    return Response(content=str(reply), media_type="application/xml")


def _send_whatsapp(to_number: str, from_number: str, body: str, media_url: str | None) -> None:
    """Send a message via Twilio's REST API — the out-of-band reply path.

    UCXP resolution takes ~11–27 s (sarvam-105b reasoning), but a Twilio webhook
    must answer in ~10 s. So we ack the webhook instantly and deliver the real
    answer here once it's ready. Requires the account credentials.
    """
    settings = get_settings()
    if not settings.whatsapp_enabled:
        logger.warning(
            "whatsapp.no_credentials — set TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN "
            "in .env to deliver replies (resolution ran, but can't be sent back)"
        )
        return
    from twilio.rest import Client

    client = Client(settings.twilio_account_sid, settings.twilio_auth_token)
    kwargs: dict[str, Any] = {"from_": from_number, "to": to_number, "body": body}
    if media_url:
        kwargs["media_url"] = [media_url]
    try:
        client.messages.create(**kwargs)
    except Exception as exc:  # noqa: BLE001 — a send failure must not crash the worker
        logger.error(f"whatsapp.send_failed to={to_number} {exc}")


async def _process(
    sender: str,
    to_number: str,
    from_number: str,
    base_url: str,
    body: str,
    num_media: int,
    media_url_in: str | None,
    media_type_in: str | None,
) -> None:
    """Background worker: resolve the message, then deliver the reply via REST."""
    settings = get_settings()
    text, language, kind = await _resolve_input(body, num_media, media_url_in, media_type_in)
    logger.info(f"whatsapp.in from={sender} kind={kind} chars={len(text)}")

    if not text:
        _send_whatsapp(to_number, from_number, _EMPTY_MESSAGES.get(
            kind,
            "I can help with orders, bills, appointments and complaints — send a message, "
            "a voice note, or a PDF/photo.",
        ), None)
        return

    final, _ = await _get_runtime().run(
        text,
        conversation_id=f"wa:{sender}",
        user_id=f"wa:{sender}",
        language=language,
        # A business's WhatsApp number is its own support line — pin every turn
        # to that business when configured (UCXP_WHATSAPP_BUSINESS).
        force_business_id=settings.whatsapp_business or None,
    )
    reply = final.get("reply_text") or final.get("reply_en") or "Done."
    logger.info(
        f"whatsapp.out to={sender} business={final.get('business_id')} "
        f"capability={final.get('capability_id')} state={final.get('status')}"
    )

    # Match the reply modality to the request: a voice note gets a spoken
    # reply, text/PDF/image get text. `whatsapp_speak` is an optional override
    # to voice *every* reply.
    want_voice = kind == "audio" or settings.whatsapp_speak

    media_url: str | None = None
    if want_voice and reply:
        spoken = await _get_runtime().engine.speak(reply, language=final.get("language", "en-IN"))
        if spoken.success and spoken.audio_base64:
            mp3 = _wav_to_mp3(base64.b64decode(spoken.audio_base64))
            if mp3:
                media_id = _stash_media(mp3, "audio/mpeg")
                base = base_url.rstrip("/").replace("http://", "https://")
                media_url = f"{base}/whatsapp/media/{media_id}.mp3"
        # If TTS/transcode fails, media_url stays None and the text still goes —
        # the customer always gets an answer.

    _send_whatsapp(to_number, from_number, reply, media_url)


@router.post("/webhook")
async def whatsapp_webhook(
    request: Request,
    background: BackgroundTasks,
    From: Annotated[str, Form()] = "",
    To: Annotated[str, Form()] = "",
    Body: Annotated[str, Form()] = "",
    NumMedia: Annotated[str, Form()] = "0",
    MediaUrl0: Annotated[str | None, Form()] = None,
    MediaContentType0: Annotated[str | None, Form()] = None,
    ProfileName: Annotated[str | None, Form()] = None,
) -> Response:
    # Identity = the WhatsApp number. It keys both the conversation (memory)
    # and the user, so "Cancel it." resolves without repeating anything.
    sender = From.replace("whatsapp:", "").strip() or "unknown"
    try:
        num_media = int(NumMedia or "0")
    except ValueError:
        num_media = 0

    # Nothing to act on (e.g. a sticker or an empty body): answer synchronously
    # with guidance, no background work.
    if num_media == 0 and not Body.strip():
        return _twiml(
            "I can help with orders, bills, appointments and complaints — send a message, "
            "a voice note, or a PDF/photo."
        )

    # Resolution is far slower than Twilio's ~10 s webhook timeout, so we hand
    # the work to a background task and reply instantly with an acknowledgement
    # (Twilio delivers this TwiML now; the real answer follows via REST). `To`
    # is the sandbox number — the from-address for our REST reply back to `From`.
    background.add_task(
        _process,
        sender,
        From,  # reply goes to the sender
        To,  # ...from the sandbox number
        str(request.base_url),
        Body,
        num_media,
        MediaUrl0,
        MediaContentType0,
    )
    # WhatsApp can't unsend a delivered message, so a waiting ack necessarily
    # lingers. When acks are disabled we stay silent and let the single real
    # reply arrive — a clean chat, at the cost of ~20 s with no feedback.
    if not get_settings().whatsapp_ack:
        return _twiml()

    mtype = MediaContentType0 or ""
    if not num_media:
        ack = "⏳ Got it — working on that now, one moment…"
    elif mtype.startswith("audio/"):
        ack = "🎙️ Got your voice note — working on it…"
    elif mtype == "application/pdf":
        ack = "📄 Got your document — reading it now, one moment…"
    elif mtype.startswith("image/"):
        ack = "🖼️ Got your screenshot — reading the details, one moment…"
    else:
        ack = "⏳ Got it — working on that now, one moment…"
    return _twiml(ack)


@router.get("/media/{media_id}")
async def whatsapp_media(media_id: str) -> Response:
    key = media_id.split(".")[0]
    entry = _MEDIA.get(key)
    if not entry:
        return Response(status_code=404)
    data, content_type = entry
    return Response(content=data, media_type=content_type)
