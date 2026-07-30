"""The UCXP Runtime — PLAN.md §6.

    uvicorn backend.app.main:app --reload --port 8000

Talks to clients over HTTP, to the AI Engine in-process, and to businesses only
through their manifests.
"""

from __future__ import annotations

import asyncio
import hashlib
import time
from contextlib import asynccontextmanager, suppress
from typing import Annotated, Any, AsyncIterator

from fastapi import FastAPI, File, Form, Header, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from loguru import logger

from ai_engine import SarvamOrchestrator

from .agent_tools import router as agent_router
from .agent_tools.execute import aclose_executor
from .api.whatsapp import router as whatsapp_router
from .connectors.shopify import router as shopify_router
from .auth import resolve_user
from .config import get_settings
from .documents import EMPTY_MESSAGES, extract
from .memory.session_store import get_session_store
from .memory.context import get_store
from .mock.router import router as mock_router
from .voice_phrases import hang_up_hint, with_follow_up
from .runtime.graph import UcxpRuntime
from .runtime.loader import get_registry
from .schemas.api import (
    BusinessOut,
    ChatRequest,
    ChatResponse,
    DocumentResponse,
    HealthOut,
    NeedsOut,
    ReceiptOut,
    VoiceResponse,
)

settings = get_settings()

_engine: SarvamOrchestrator | None = None
_runtime: UcxpRuntime | None = None


def get_runtime() -> UcxpRuntime:
    global _engine, _runtime
    if _runtime is None:
        _engine = SarvamOrchestrator()
        _runtime = UcxpRuntime(_engine)
    return _runtime


async def _watch_manifests(runtime: UcxpRuntime, every: int) -> None:
    """Keep the directory in step with what merchants have published.

    The dashboard writes to Supabase and knows nothing about this process, so
    something has to look. Polling rather than a webhook because the runtime is
    the only party that has to be right, and a missed webhook fails silently
    where a missed poll just corrects itself a minute later.

    Never raises: a database blip must not end the task and leave the directory
    frozen for the life of the process.
    """
    while True:
        await asyncio.sleep(every)
        try:
            before = set(runtime.registry.ids())
            await runtime.registry.refresh_from_store()
            after = set(runtime.registry.ids())
            if before != after:
                logger.info(
                    f"manifests.changed added={sorted(after - before)} "
                    f"removed={sorted(before - after)} total={len(after)}"
                )
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # noqa: BLE001 - a poll must never kill the loop
            logger.warning(f"manifests.refresh_failed error={exc}")


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    runtime = get_runtime()
    # Pull published manifests before serving. Falls back to the local files
    # when Supabase is unset or unreachable, so startup never depends on it.
    await runtime.registry.refresh_from_store()
    logger.info(
        f"runtime.startup manifests={runtime.registry.ids()} mock_base={settings.mock_base_url}"
    )
    watcher: asyncio.Task[None] | None = None
    if settings.manifest_refresh_seconds > 0:
        watcher = asyncio.create_task(
            _watch_manifests(runtime, settings.manifest_refresh_seconds)
        )
        logger.info(f"manifests.watching every={settings.manifest_refresh_seconds}s")

    try:
        yield
    finally:
        if watcher is not None:
            watcher.cancel()
            with suppress(asyncio.CancelledError):
                await watcher
        await runtime.executor.aclose()
        await aclose_executor()
        if _engine is not None:
            await _engine.aclose()
        logger.info("runtime.shutdown")


app = FastAPI(
    title="UCXP Runtime",
    version="0.1.0",
    description="Generic customer-resolution runtime. Business behaviour comes from manifests.",
    lifespan=lifespan,
)

# The app is a separate origin during development.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(mock_router)
app.include_router(shopify_router)
app.include_router(whatsapp_router)
# The tool a managed voice agent (Samvaad) calls to resolve real jobs — PLAN §11.
app.include_router(agent_router)


def _to_response(final: dict[str, Any], conversation_id: str, latency_ms: float) -> ChatResponse:
    receipt = final.get("receipt")
    missing = final.get("missing_input")
    needs = (
        NeedsOut(input=missing, prompt=final.get("missing_prompt") or "")
        if missing and missing != "__confirm__"
        else None
    )
    return ChatResponse(
        conversation_id=conversation_id,
        reply_text=final.get("reply_text") or final.get("reply_en") or "",
        business_id=final.get("business_id"),
        capability=final.get("capability_id"),
        receipt=ReceiptOut(**receipt) if receipt else None,
        needs=needs,
        state=final.get("status", "resolved"),
        language=final.get("language", "en-IN"),
        degraded=list(final.get("degraded") or []),
        latency_ms=round(latency_ms, 2),
    )


# --------------------------------------------------------------------------- #
# Conversation
# --------------------------------------------------------------------------- #
@app.post("/chat", response_model=ChatResponse, tags=["conversation"])
async def chat(
    request: ChatRequest,
    authorization: Annotated[str | None, Header()] = None,
) -> ChatResponse:
    started = time.perf_counter()
    # Optional: an anonymous caller is still served, they just get no history.
    caller = await resolve_user(authorization)
    user_id = caller.id if caller else request.user_id

    final, conversation = await get_runtime().run(
        request.text,
        conversation_id=request.conversation_id,
        language=request.language,
        user_id=user_id,
        force_business_id=request.business_id,
    )
    elapsed = (time.perf_counter() - started) * 1000
    logger.info(
        f"chat.done conversation={conversation.id} business={final.get('business_id')} "
        f"capability={final.get('capability_id')} state={final.get('status')} "
        f"total_ms={elapsed:.0f} steps={final.get('latency')}"
    )
    response = _to_response(final, conversation.id, elapsed)
    # Durable record, fire-and-forget — the customer never waits on the DB.
    get_session_store().record_turn_later(
        conversation_id=conversation.id,
        user_id=caller.id if caller else None,
        channel="app",
        external_id=None,
        business_id=final.get("business_id"),
        language=final.get("language", "en-IN"),
        user_text=request.text,
        reply_text=response.reply_text,
        capability=final.get("capability_id"),
        receipt=response.receipt.model_dump() if response.receipt else None,
        latency_ms=elapsed,
    )
    return response


@app.post("/transcribe", tags=["conversation"])
async def transcribe(
    file: Annotated[UploadFile, File(description="Audio clip, 30 s max")],
    language: Annotated[str | None, Form()] = None,
) -> dict[str, Any]:
    """Speech to text only — no routing, no action, nothing executed.

    The app transcribes first so it can show the customer their own words
    immediately, then sends the text through /chat. Resolution must not happen
    here, or a capability would run twice.
    """
    audio = await file.read()
    speech = await get_runtime().engine.transcribe(
        audio, filename=file.filename or "audio.m4a", language=language
    )
    if not speech.success:
        raise HTTPException(
            status_code=422, detail=speech.error.message if speech.error else "Transcription failed"
        )
    return {
        "success": True,
        "transcript": speech.transcript,
        "detected_language": speech.detected_language.value,
    }


@app.post("/document", response_model=DocumentResponse, tags=["conversation"])
async def document(
    file: Annotated[UploadFile, File(description="PDF, photo or screenshot (10 MB max)")],
    caption: Annotated[str | None, Form()] = None,
    conversation_id: Annotated[str | None, Form()] = None,
    language: Annotated[str | None, Form()] = None,
    user_id: Annotated[str | None, Form()] = None,
    business_id: Annotated[str | None, Form()] = None,
    authorization: Annotated[str | None, Header()] = None,
) -> DocumentResponse:
    """A document in, a resolved job out — the same path text takes.

    The customer photographs an order confirmation instead of typing the order
    number. We extract the text, frame it as reference material, and hand it to
    `runtime.run`, so routing, slot-filling and receipts behave exactly as they
    do for a typed message. This is the WhatsApp document path, reachable from
    the app and the browser.
    """
    started = time.perf_counter()
    caller = await resolve_user(authorization)
    resolved_user = caller.id if caller else user_id

    data = await file.read()
    result = extract(
        data,
        content_type=file.content_type,
        filename=file.filename,
        caption=caption or "",
    )

    # An unreadable file is a conversation turn, not an HTTP error: the customer
    # gets a bubble telling them what to do next, in the same place every other
    # reply appears. A 4xx would surface as a generic network failure instead.
    if not result.ok:
        logger.info(
            f"document.rejected file={file.filename} type={file.content_type} "
            f"kind={result.kind} error={result.error}"
        )
        return DocumentResponse(
            conversation_id=conversation_id or "",
            reply_text=EMPTY_MESSAGES.get(result.kind, EMPTY_MESSAGES["unsupported"]),
            state="failed",
            document_kind=result.kind,
            latency_ms=round((time.perf_counter() - started) * 1000, 2),
        )

    final, conversation = await get_runtime().run(
        result.text,
        conversation_id=conversation_id,
        language=language,
        user_id=resolved_user,
        force_business_id=business_id,
        # The evidence trail. The digest is what makes it auditable later: the
        # same photo sent twice is provably the same photo.
        attachment={
            "kind": result.kind,
            "filename": file.filename,
            "digest": hashlib.sha256(data).hexdigest()[:16],
            "chars": len(result.raw),
        },
    )
    elapsed = (time.perf_counter() - started) * 1000
    logger.info(
        f"document.done conversation={conversation.id} kind={result.kind} "
        f"chars={len(result.raw)} business={final.get('business_id')} "
        f"capability={final.get('capability_id')} state={final.get('status')} total_ms={elapsed:.0f}"
    )

    base = _to_response(final, conversation.id, elapsed)
    response = DocumentResponse(
        **base.model_dump(),
        document_kind=result.kind,
        extracted_chars=len(result.raw),
    )

    # History shows what the customer sent, not the framed prompt we built from
    # it — a wall of OCR text in the transcript helps nobody.
    summary = (caption or "").strip() or f"[{result.kind}] {file.filename or 'document'}"
    get_session_store().record_turn_later(
        conversation_id=conversation.id,
        user_id=caller.id if caller else None,
        channel="app",
        external_id=None,
        business_id=final.get("business_id"),
        language=final.get("language", "en-IN"),
        user_text=summary,
        reply_text=response.reply_text,
        capability=final.get("capability_id"),
        receipt=response.receipt.model_dump() if response.receipt else None,
        latency_ms=elapsed,
    )
    return response


@app.post("/voice", response_model=VoiceResponse, tags=["conversation"])
async def voice(
    file: Annotated[UploadFile, File(description="Audio clip, 30 s max")],
    conversation_id: Annotated[str | None, Form()] = None,
    user_id: Annotated[str | None, Form()] = None,
    speak: Annotated[bool, Form()] = True,
    business_id: Annotated[str | None, Form()] = None,
) -> VoiceResponse:
    """Speech in, resolution out, spoken back in the caller's language.

    ``business_id`` pins the turn to one merchant — a call placed from that
    business's screen. Omitted ⇒ the runtime routes across every manifest,
    matching the central chat.
    """
    started = time.perf_counter()
    runtime = get_runtime()

    audio = await file.read()
    speech = await runtime.engine.transcribe(audio, filename=file.filename or "audio.m4a")
    if not speech.success:
        raise HTTPException(status_code=422, detail=speech.error.message if speech.error else "Transcription failed")

    final, conversation = await runtime.run(
        speech.transcript,
        conversation_id=conversation_id,
        language=speech.detected_language.value,
        user_id=user_id,
        force_business_id=business_id,
    )

    audio_b64 = ""
    degraded = list(final.get("degraded") or [])
    reply = final.get("reply_text") or final.get("reply_en") or ""

    # On a call the assistant has to hand the turn back audibly, so a finished
    # answer ends by inviting the next question. Applied here rather than in the
    # graph: /chat shows the same reply on screen, where it would just be noise.
    language = final.get("language", "en-IN")
    if final.get("farewell"):
        # Signing off: point at the button rather than asking another question.
        reply = f"{reply} {hang_up_hint(language)}".strip()
    else:
        reply = with_follow_up(reply, language=language, resolved=final.get("status") == "resolved")

    if speak and reply:
        spoken = await runtime.engine.speak(reply, language=final.get("language", "en-IN"))
        if spoken.success:
            audio_b64 = spoken.audio_base64
        else:
            degraded.append("tts")

    elapsed = (time.perf_counter() - started) * 1000
    base = _to_response(final, conversation.id, elapsed)
    base.reply_text = reply
    logger.info(
        f"voice.done conversation={conversation.id} language={speech.detected_language.value} "
        f"capability={final.get('capability_id')} audio={'yes' if audio_b64 else 'no'} total_ms={elapsed:.0f}"
    )
    return VoiceResponse(
        **base.model_dump(exclude={"degraded"}),
        degraded=degraded,
        transcript=speech.transcript,
        detected_language=speech.detected_language.value,
        audio_base64=audio_b64,
    )


# --------------------------------------------------------------------------- #
# Protocol introspection — judges will ask to see these
# --------------------------------------------------------------------------- #
@app.get("/businesses", response_model=list[BusinessOut], tags=["protocol"])
async def businesses() -> list[BusinessOut]:
    """The directory, derived from manifests — never hardcoded."""
    return [
        BusinessOut(
            id=m.business.id,
            name=m.business.name,
            category=m.business.category,
            glyph=m.business.glyph,
            color=m.business.color,
            capabilities=[c.id for c in m.capabilities],
            languages=m.business.languages,
        )
        for m in get_registry().all()
    ]


@app.get("/manifests/{business_id}", tags=["protocol"])
async def manifest(business_id: str) -> dict[str, Any]:
    """The raw manifest. This is the "there is no Airtel code" moment."""
    raw = get_registry().raw(business_id)
    if raw is None:
        raise HTTPException(status_code=404, detail=f"No manifest for '{business_id}'")
    return raw


@app.post("/manifests/reload", tags=["protocol"])
async def reload_manifests() -> dict[str, Any]:
    """Add a business without restarting — the protocol claim, made tangible."""
    registry = get_registry()
    adopted = await registry.refresh_from_store()
    return {"loaded": registry.ids(), "from_database": adopted}


@app.get("/history", tags=["conversation"])
async def history(
    user_id: str | None = None,
    authorization: Annotated[str | None, Header()] = None,
) -> dict[str, Any]:
    """Past conversations.

    A signed-in caller gets their durable history from the database. Without a
    token we fall back to this process's in-memory store, so the endpoint keeps
    working signed-out and before Supabase is configured.
    """
    caller = await resolve_user(authorization)
    if caller:
        rows = await get_session_store().history(caller.id)
        if rows:
            return {
                "conversations": [
                    {
                        "id": r.get("id"),
                        "business_id": r.get("business_id"),
                        "language": r.get("language"),
                        "channel": r.get("channel"),
                        "updated_at": r.get("updated_at"),
                    }
                    for r in rows
                ],
                "source": "database",
            }

    wanted = caller.id if caller else user_id
    conversations = [
        {
            "id": c.id,
            "business_id": c.business_id,
            "language": c.language,
            "turns": len(c.turns),
            "preview": c.turns[-1]["content"] if c.turns else "",
            "updated_at": c.updated_at,
        }
        for c in get_store().all()
        if wanted is None or c.user_id == wanted
    ]
    return {"conversations": conversations, "source": "memory"}


@app.get("/health", response_model=HealthOut, tags=["meta"])
async def health() -> HealthOut:
    runtime = get_runtime()
    engine_health = runtime.engine.health()
    return HealthOut(
        manifests=runtime.registry.ids(),
        manifest_store={
            "configured": settings.supabase_configured,
            "persist_sessions": settings.persist_sessions,
            "jwt_local_verify": bool(settings.supabase_jwt_secret),
            "url_set": bool(settings.supabase_url),
            "key_set": bool(settings.supabase_key),
            "table": settings.manifest_table,
        },
        ai_engine={
            "status": engine_health.status,
            "configured": engine_health.configured,
            "llm": engine_health.models.get("llm", ""),
        },
    )


def main() -> None:  # pragma: no cover
    import uvicorn

    # settings.port already honours $PORT, so `python -m backend.app.main`
    # works unchanged locally and on a host that injects one.
    uvicorn.run("backend.app.main:app", host=settings.host, port=settings.port, reload=False)


if __name__ == "__main__":  # pragma: no cover
    main()
