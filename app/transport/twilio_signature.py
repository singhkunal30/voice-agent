"""Twilio webhook signature verification.

Twilio signs every webhook request with HMAC-SHA1 over a canonical
string: `url + sorted_params_concatenated`. We must verify the
signature on inbound webhooks so an attacker can't trigger our agent
or burn Twilio credits by hitting our endpoint directly.

The `twilio` SDK ships a `RequestValidator` that does this — we just
wrap it as a FastAPI dependency.

Refs:
  * https://www.twilio.com/docs/usage/webhooks/webhooks-security
"""

from __future__ import annotations

from typing import Optional

from fastapi import Header, HTTPException, Request, status
from twilio.request_validator import RequestValidator

from ..config import Settings, get_settings


def _build_full_url(request: Request) -> str:
    """Twilio signs against the exact URL it called.

    Behind a TLS-terminating proxy, `request.url` may show
    `http://...` even though Twilio actually called `https://`. We
    rebuild from PUBLIC_BASE_URL + path to match what Twilio signed.
    """
    settings = get_settings()
    base = (settings.public_base_url or "").rstrip("/")
    path_qs = request.url.path
    if request.url.query:
        path_qs = f"{path_qs}?{request.url.query}"
    if base:
        return f"{base}{path_qs}"
    # Fallback: trust whatever Starlette computed.
    return str(request.url)


async def verify_twilio_signature(
    request: Request,
    x_twilio_signature: Optional[str] = Header(default=None),
) -> None:
    """FastAPI dependency. Raises 401 on a missing or bad signature."""
    settings = get_settings()
    if not settings.twilio_auth_token:
        # Refusing to operate without a configured token avoids the
        # common "accidentally accepting any request" footgun.
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Twilio auth token is not configured",
        )
    if not x_twilio_signature:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="missing X-Twilio-Signature header",
        )

    form = await request.form()
    params = {k: str(v) for k, v in form.items()}
    url = _build_full_url(request)

    validator = RequestValidator(settings.twilio_auth_token)
    if not validator.validate(url, params, x_twilio_signature):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="invalid Twilio signature",
        )
