"""Webhook authentication.

Supports both auth modes Vapi exposes today:

1. Shared secret (default, simplest): Vapi sends the configured secret in
   `X-Vapi-Secret` (legacy) or as a Bearer token in `Authorization` (the
   newer credential-based path). We accept either header; both are
   compared in constant time.

2. HMAC signature (optional, opt-in via env): Vapi sends a hex
   HMAC-SHA256 of the raw request body in a configurable header (default
   `x-vapi-signature`). When `VAPI_HMAC_ENABLED=true`, the signature
   header MUST be present and valid — the secret-token check is then a
   fallback for legacy callers.

Refs:
- https://docs.vapi.ai/server-url/server-authentication (verified May 2026)
"""

from __future__ import annotations

import hmac
from hashlib import sha256

from fastapi import Header, HTTPException, Request, status

from .config import Settings, get_settings


def _consteq(a: str, b: str) -> bool:
    if not a or not b:
        return False
    return hmac.compare_digest(a.encode("utf-8"), b.encode("utf-8"))


def _strip_bearer(value: str | None) -> str | None:
    if value is None:
        return None
    v = value.strip()
    if v.lower().startswith("bearer "):
        return v[7:].strip()
    return v


def _check_secret_token(
    settings: Settings,
    authorization: str | None,
    x_vapi_secret: str | None,
) -> bool:
    expected = settings.vapi_server_secret
    if not expected:
        return False
    candidates: list[str] = []
    bearer = _strip_bearer(authorization)
    if bearer:
        candidates.append(bearer)
    if x_vapi_secret:
        candidates.append(x_vapi_secret.strip())
    return any(_consteq(c, expected) for c in candidates)


def _check_hmac(settings: Settings, body: bytes, signature: str | None) -> bool:
    if not signature or not settings.vapi_hmac_secret:
        return False
    mac = hmac.new(
        settings.vapi_hmac_secret.encode("utf-8"), body, sha256
    ).hexdigest()
    # Vapi may include the algorithm as a prefix in some configurations
    # (e.g. "sha256=<hex>"); accept either.
    candidate = signature.strip()
    if "=" in candidate:
        _, _, candidate = candidate.partition("=")
    return _consteq(mac, candidate)


async def verify_vapi_request(
    request: Request,
    authorization: str | None = Header(default=None),
    x_vapi_secret: str | None = Header(default=None, alias="X-Vapi-Secret"),
) -> bytes:
    """FastAPI dependency. Returns the raw request body on success.

    Returning the body lets the route avoid reading it twice (signature
    verification requires the exact bytes Vapi signed).
    """
    settings = get_settings()
    body = await request.body()

    if settings.vapi_hmac_enabled:
        sig_header = settings.vapi_hmac_header
        # Header names are case-insensitive in HTTP; FastAPI/Starlette
        # normalize to lowercase.
        sig = request.headers.get(sig_header.lower())
        if _check_hmac(settings, body, sig):
            return body
        # Fall through to the secret-token check so a deployment can
        # rotate to HMAC without breaking older callers in the same
        # window.

    if _check_secret_token(settings, authorization, x_vapi_secret):
        return body

    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="invalid or missing webhook credentials",
    )
