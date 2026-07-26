"""The UCXP Runtime — PLAN.md §6.

    uvicorn backend.app.main:app --reload --port 8000

Talks to clients over HTTP, to the AI Engine in-process, and to businesses only
through their manifests.
"""

from __future__ import annotations

import time
from contextlib import asynccontextmanager
from typing import Annotated, Any, AsyncIterator

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from loguru import logger

from ai_engine import SarvamOrchestrator

from .api.whatsapp import router as whatsapp_router
from .connectors.shopify import router as shopify_router
from .config import get_settings
from .memory.context import get_store
from .mock.router import router as mock_router
from .runtime.graph import UcxpRuntime
from .runtime.loader import get_registry
from .schemas.api import (
    BusinessOut,
    ChatRequest,
    ChatResponse,
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


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    runtime = get_runtime()
    logger.info(
        f"runtime.startup manifests={runtime.registry.ids()} mock_base={settings.mock_base_url}"
    )
    try:
        yield
    finally:
        await runtime.executor.aclose()
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
async def chat(request: ChatRequest) -> ChatResponse:
    started = time.perf_counter()
    final, conversation = await get_runtime().run(
        request.text,
        conversation_id=request.conversation_id,
        language=request.language,
        user_id=request.user_id,
        force_business_id=request.business_id,
    )
    elapsed = (time.perf_counter() - started) * 1000
    logger.info(
        f"chat.done conversation={conversation.id} business={final.get('business_id')} "
        f"capability={final.get('capability_id')} state={final.get('status')} "
        f"total_ms={elapsed:.0f} steps={final.get('latency')}"
    )
    return _to_response(final, conversation.id, elapsed)


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


@app.post("/voice", response_model=VoiceResponse, tags=["conversation"])
async def voice(
    file: Annotated[UploadFile, File(description="Audio clip, 30 s max")],
    conversation_id: Annotated[str | None, Form()] = None,
    user_id: Annotated[str | None, Form()] = None,
    speak: Annotated[bool, Form()] = True,
) -> VoiceResponse:
    """Speech in, resolution out, spoken back in the caller's language."""
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
    )

    audio_b64 = ""
    degraded = list(final.get("degraded") or [])
    reply = final.get("reply_text") or final.get("reply_en") or ""
    if speak and reply:
        spoken = await runtime.engine.speak(reply, language=final.get("language", "en-IN"))
        if spoken.success:
            audio_b64 = spoken.audio_base64
        else:
            degraded.append("tts")

    elapsed = (time.perf_counter() - started) * 1000
    base = _to_response(final, conversation.id, elapsed)
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
    registry.reload()
    return {"loaded": registry.ids()}


@app.get("/history", tags=["conversation"])
async def history(user_id: str | None = None) -> dict[str, Any]:
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
        if user_id is None or c.user_id == user_id
    ]
    return {"conversations": conversations}


@app.get("/health", response_model=HealthOut, tags=["meta"])
async def health() -> HealthOut:
    runtime = get_runtime()
    engine_health = runtime.engine.health()
    return HealthOut(
        manifests=runtime.registry.ids(),
        ai_engine={
            "status": engine_health.status,
            "configured": engine_health.configured,
            "llm": engine_health.models.get("llm", ""),
        },
    )


def main() -> None:  # pragma: no cover
    import uvicorn

    uvicorn.run("backend.app.main:app", host=settings.host, port=settings.port, reload=False)


if __name__ == "__main__":  # pragma: no cover
    main()
