"""HTTP surface of the AI Engine.

This is the *engine's own* service so the UCXP Runtime can reach it over the
network instead of importing Python.  It is a 1:1 mapping onto the
orchestrator: no business logic, no auth, no database, no workflows.

    uvicorn ai_engine.app:app --reload --port 8080
"""

from __future__ import annotations

from contextlib import asynccontextmanager
from typing import Annotated, Any, AsyncIterator

from fastapi import FastAPI, File, Form, UploadFile
from fastapi.responses import JSONResponse
from loguru import logger

from .config import get_settings
from .orchestrator import ENGINE_VERSION, SarvamOrchestrator
from .prompts import get_prompt_manager
from .schemas import (
    HealthResponse,
    LLMResponse,
    ReasonRequest,
    SpeakRequest,
    SpeechResponse,
    TextRequest,
    TextResponse,
    TranslateRequest,
    TranslationResponse,
    TransliterateRequest,
    TransliterationResponse,
    TTSResponse,
    VoiceResponse,
)

_engine: SarvamOrchestrator | None = None


def get_engine() -> SarvamOrchestrator:
    """The process-wide orchestrator (created on startup)."""
    global _engine
    if _engine is None:
        _engine = SarvamOrchestrator()
    return _engine


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    engine = get_engine()
    logger.info("api.startup")
    try:
        yield
    finally:
        await engine.aclose()
        logger.info("api.shutdown")


settings = get_settings()
app = FastAPI(
    title=settings.api_title,
    version=ENGINE_VERSION,
    description="Single interface over Sarvam AI: speech, translation, reasoning, synthesis.",
    lifespan=lifespan,
)


def _status(response: Any) -> int:
    """Failed pipelines answer 200 only if they produced something usable."""
    if getattr(response, "success", True):
        return 200
    error = getattr(response, "error", None)
    code = getattr(error, "status_code", None)
    if code in (401, 403):
        return 502  # never leak upstream auth codes as our own
    return 502 if code and code >= 500 else 422


def _json(response: Any) -> JSONResponse:
    return JSONResponse(status_code=_status(response), content=response.model_dump(mode="json"))


# --------------------------------------------------------------------------- #
# Meta
# --------------------------------------------------------------------------- #
@app.get("/health", response_model=HealthResponse, tags=["meta"])
async def health() -> HealthResponse:
    return get_engine().health()


@app.get("/v1/prompts", tags=["meta"])
async def list_prompts() -> dict[str, Any]:
    manager = get_prompt_manager()
    return {
        "prompts": [
            {
                "key": spec.key,
                "kind": spec.kind,
                "version": spec.version,
                "description": spec.description,
                "variables": spec.variables,
            }
            for spec in manager.all().values()
        ]
    }


@app.post("/v1/_diag", tags=["meta"])
async def client_diagnostics(payload: dict[str, Any]) -> dict[str, str]:
    """Sink for client-side diagnostics.

    Mobile logs are awkward to read off a device, so the app forwards its
    events here and they land in the engine's log next to the request they
    relate to. Development aid only — no business meaning, no persistence.
    """
    event = str(payload.get("event", "unknown"))
    fields = " ".join(f"{k}={v}" for k, v in payload.items() if k != "event")
    logger.info(f"client.diag event={event} {fields}")
    return {"status": "logged"}


@app.get("/v1/voices", tags=["meta"])
async def list_voices() -> dict[str, Any]:
    from .tts import TTSService

    return {"speakers": TTSService.available_speakers()}


# --------------------------------------------------------------------------- #
# Pipelines
# --------------------------------------------------------------------------- #
@app.post("/v1/voice", response_model=VoiceResponse, tags=["pipelines"])
async def process_voice(
    file: Annotated[UploadFile, File(description="Audio clip (wav/mp3/m4a/ogg/flac)")],
    language: Annotated[str | None, Form()] = None,
    target_language: Annotated[str | None, Form()] = None,
    prompt_key: Annotated[str | None, Form()] = None,
    speaker: Annotated[str | None, Form()] = None,
    speak_response: Annotated[bool, Form()] = True,
    session_id: Annotated[str | None, Form()] = None,
) -> Any:
    audio = await file.read()
    response = await get_engine().process_voice(
        audio,
        filename=file.filename or "audio.wav",
        language=language,
        target_language=target_language,
        prompt_key=prompt_key,
        speaker=speaker,
        speak_response=speak_response,
        request_id=session_id,
    )
    return _json(response)


@app.post("/v1/text", response_model=TextResponse, tags=["pipelines"])
async def process_text(request: TextRequest) -> Any:
    response = await get_engine().process_text(
        request.text,
        language=request.language,
        target_language=request.target_language,
        prompt_key=request.prompt_key,
        prompt_variables=request.prompt_variables,
        history=request.history,
        temperature=request.temperature,
        max_tokens=request.max_tokens,
    )
    return _json(response)


# --------------------------------------------------------------------------- #
# Individual capabilities
# --------------------------------------------------------------------------- #
@app.post("/v1/transcribe", response_model=SpeechResponse, tags=["capabilities"])
async def transcribe(
    file: Annotated[UploadFile, File()],
    language: Annotated[str | None, Form()] = None,
    translate_to_english: Annotated[bool, Form()] = False,
) -> Any:
    audio = await file.read()
    response = await get_engine().transcribe(
        audio,
        filename=file.filename or "audio.wav",
        language=language,
        translate_to_english=translate_to_english,
    )
    return _json(response)


@app.post("/v1/translate", response_model=TranslationResponse, tags=["capabilities"])
async def translate(request: TranslateRequest) -> Any:
    response = await get_engine().translate(
        request.text,
        target_language=request.target_language,
        source_language=request.source_language,
        mode=request.mode,
    )
    return _json(response)


@app.post("/v1/transliterate", response_model=TransliterationResponse, tags=["capabilities"])
async def transliterate(request: TransliterateRequest) -> Any:
    response = await get_engine().transliterate(
        request.text,
        target_language=request.target_language,
        source_language=request.source_language,
        spoken_form=request.spoken_form,
    )
    return _json(response)


@app.post("/v1/detect", tags=["capabilities"])
async def detect(payload: dict[str, str]) -> Any:
    response = await get_engine().detect_language(payload.get("text", ""))
    return _json(response)


@app.post("/v1/speak", response_model=TTSResponse, tags=["capabilities"])
async def speak(request: SpeakRequest) -> Any:
    response = await get_engine().speak(
        request.text,
        language=request.language,
        speaker=request.speaker,
        pace=request.pace,
        pitch=request.pitch,
        loudness=request.loudness,
    )
    return _json(response)


@app.post("/v1/reason", response_model=LLMResponse, tags=["capabilities"])
async def reason(request: ReasonRequest) -> Any:
    response = await get_engine().reason(
        request.text,
        messages=request.messages,
        prompt_key=request.prompt_key,
        prompt_variables=request.prompt_variables,
        temperature=request.temperature,
        max_tokens=request.max_tokens,
    )
    return _json(response)


def main() -> None:  # pragma: no cover - manual entry point
    import uvicorn

    uvicorn.run(
        "ai_engine.app:app",
        host=settings.api_host,
        port=settings.api_port,
        reload=False,
    )


if __name__ == "__main__":  # pragma: no cover
    main()
