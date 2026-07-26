"""Action execution — the step that makes this resolution, not conversation.

Takes an endpoint declared in a manifest, renders its URL/body against the
collected inputs, calls it, and returns the result. The runtime has no idea
which business it just acted on.
"""

from __future__ import annotations

from typing import Any

import httpx
from loguru import logger

from ..config import RuntimeSettings, get_settings
from ..schemas.manifest import Endpoint, Manifest
from .renderer import RenderError, render, render_value


class ActionError(RuntimeError):
    """The declared endpoint could not be called, or refused."""

    def __init__(self, message: str, *, status: int | None = None) -> None:
        super().__init__(message)
        self.message = message
        self.status = status


class ActionExecutor:
    """Calls the endpoints a manifest declares."""

    def __init__(self, settings: RuntimeSettings | None = None, *, client: httpx.AsyncClient | None = None):
        self.settings = settings or get_settings()
        self._owns_client = client is None
        self._client = client or httpx.AsyncClient(timeout=self.settings.action_timeout_s)

    async def aclose(self) -> None:
        if self._owns_client and not self._client.is_closed:
            await self._client.aclose()

    async def execute(
        self,
        manifest: Manifest,
        endpoint_id: str,
        scope: dict[str, Any],
    ) -> dict[str, Any]:
        """Render and call *endpoint_id*, returning the JSON body."""
        endpoint: Endpoint | None = manifest.endpoint(endpoint_id)
        if endpoint is None:
            raise ActionError(f"Manifest '{manifest.id}' declares no endpoint '{endpoint_id}'")

        scope = {
            **scope,
            "mock_base": self.settings.mock_base_url,
            "connector_base": self.settings.connector_base_url,
        }
        try:
            url = render(endpoint.url, scope)
            body = render_value(endpoint.body, scope) if endpoint.body is not None else None
            headers = render_value(endpoint.headers, scope) if endpoint.headers else {}
        except RenderError as exc:
            raise ActionError(f"Cannot build the request for '{endpoint_id}': {exc}") from exc

        logger.info(f"action.call business={manifest.id} endpoint={endpoint_id} {endpoint.method} {url}")
        try:
            response = await self._client.request(
                endpoint.method,
                url,
                json=body if endpoint.method != "GET" else None,
                headers=headers or None,
                timeout=endpoint.timeout_s or self.settings.action_timeout_s,
            )
        except httpx.TimeoutException as exc:
            raise ActionError(f"The {manifest.business.name} service timed out.") from exc
        except httpx.HTTPError as exc:
            raise ActionError(f"Could not reach the {manifest.business.name} service: {exc}") from exc

        if response.status_code >= 400:
            detail = _error_detail(response)
            logger.warning(f"action.rejected endpoint={endpoint_id} status={response.status_code} {detail}")
            raise ActionError(detail, status=response.status_code)

        try:
            payload = response.json()
        except ValueError as exc:
            raise ActionError(f"'{endpoint_id}' returned a non-JSON response") from exc

        result = payload if isinstance(payload, dict) else {"data": payload}
        logger.info(f"action.ok endpoint={endpoint_id} fields={sorted(result)[:8]}")
        return result


def _error_detail(response: httpx.Response) -> str:
    try:
        body = response.json()
    except ValueError:
        return f"The service returned HTTP {response.status_code}."
    if isinstance(body, dict):
        for key in ("detail", "message", "error"):
            value = body.get(key)
            if isinstance(value, str) and value:
                return value
    return f"The service returned HTTP {response.status_code}."
