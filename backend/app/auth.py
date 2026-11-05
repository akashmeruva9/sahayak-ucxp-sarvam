"""Identify the caller from a Supabase access token.

Deliberately **optional**: a request without a token is served as an anonymous
session. The app is a customer-support client, not a bank — and WhatsApp has no
bearer token at all, so requiring one would break a working channel.

Two verification paths:

* ``SUPABASE_JWT_SECRET`` set — verify the HS256 signature locally. No network,
  a few hundred microseconds.
* secret absent — ask Supabase (``GET /auth/v1/user``). Correct, just slower,
  and cached briefly so a chat turn doesn't pay it repeatedly.

What we never do is decode without verifying. A forged ``user_id`` would let one
customer read another's history, and "it's only a demo" is exactly how that
ships.
"""

from __future__ import annotations

import time
from dataclasses import dataclass

import httpx
from loguru import logger

from .config import RuntimeSettings, get_settings


@dataclass(frozen=True)
class AuthedUser:
    id: str
    email: str = ""


#: token -> (user, expires_at). Small and short-lived; this is not a session store.
_cache: dict[str, tuple[AuthedUser, float]] = {}
_CACHE_TTL_S = 300


def _from_cache(token: str) -> AuthedUser | None:
    hit = _cache.get(token)
    if not hit:
        return None
    user, expires = hit
    if expires < time.time():
        _cache.pop(token, None)
        return None
    return user


def _verify_locally(token: str, settings: RuntimeSettings) -> AuthedUser | None:
    try:
        import jwt  # PyJWT
    except ImportError:  # pragma: no cover - dependency is declared
        logger.warning("auth.pyjwt_missing falling back to the Supabase endpoint")
        return None

    try:
        claims = jwt.decode(
            token,
            settings.supabase_jwt_secret,
            algorithms=["HS256"],
            # Supabase issues this audience for signed-in users.
            audience="authenticated",
        )
    except Exception as exc:  # noqa: BLE001 — any failure means "not authenticated"
        logger.info(f"auth.rejected reason={type(exc).__name__}")
        return None

    user_id = claims.get("sub")
    return AuthedUser(id=user_id, email=claims.get("email", "")) if user_id else None


async def _verify_remotely(token: str, settings: RuntimeSettings) -> AuthedUser | None:
    if not settings.supabase_configured:
        return None
    url = f"{settings.supabase_url.rstrip('/')}/auth/v1/user"
    try:
        async with httpx.AsyncClient(timeout=settings.supabase_timeout_s) as client:
            response = await client.get(
                url,
                headers={"apikey": settings.supabase_key, "Authorization": f"Bearer {token}"},
            )
        if response.status_code != 200:
            logger.info(f"auth.rejected status={response.status_code}")
            return None
        body = response.json()
    except (httpx.HTTPError, ValueError) as exc:
        logger.warning(f"auth.verify_failed error={exc}")
        return None

    user_id = body.get("id")
    return AuthedUser(id=user_id, email=body.get("email", "")) if user_id else None


def _verify_google(token: str) -> AuthedUser | None:
    """Verify Google / Firebase OAuth ID token using Google public certificates."""
    try:
        from google.oauth2 import id_token
        from google.auth.transport import requests as google_requests
        req = google_requests.Request()
        id_info = None
        try:
            id_info = id_token.verify_firebase_token(token, req)
        except Exception:
            try:
                id_info = id_token.verify_oauth2_token(token, req)
            except Exception:
                pass
        if id_info:
            user_id = id_info.get("sub") or id_info.get("user_id")
            email = id_info.get("email", "")
            if user_id:
                return AuthedUser(id=user_id, email=email)
    except Exception as exc:
        logger.debug(f"auth.google_verify_skipped: {exc}")
    return None


async def resolve_user(
    authorization: str | None, settings: RuntimeSettings | None = None
) -> AuthedUser | None:
    """Return the caller, or None for an anonymous request."""
    settings = settings or get_settings()
    if not authorization or not authorization.lower().startswith("bearer "):
        return None

    token = authorization.split(" ", 1)[1].strip()
    if not token:
        return None

    cached = _from_cache(token)
    if cached:
        return cached

    # 1. Try Google / Firebase ID token verification first
    user = _verify_google(token)

    # 2. Fall back to Supabase JWT verification
    if not user:
        user = (
            _verify_locally(token, settings)
            if settings.supabase_jwt_secret
            else await _verify_remotely(token, settings)
        )

    if user:
        _cache[token] = (user, time.time() + _CACHE_TTL_S)
        logger.info(f"auth.ok user={user.id[:8]}…")
    return user
