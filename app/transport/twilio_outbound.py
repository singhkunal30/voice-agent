"""Outbound calling via the Twilio REST API.

The flow is the inverse of inbound:

1. We POST to /2010-04-01/Accounts/{sid}/Calls.json with `to`, `from`,
   and a `url` pointing at our own `/twilio/voice` endpoint.
2. Twilio places the call; when the callee picks up, Twilio fetches
   our TwiML, gets the `<Stream>` instruction, and opens the
   WebSocket — same code path as inbound from that point onward.

We pass per-call context (firstMessage override, variables) through
URL query params on the TwiML callback. Pipecat doesn't have a
built-in equivalent of Vapi's `assistantOverrides`, so the inbound
webhook reads these query params and injects them into the
greeting/system prompt before starting the pipeline.

NOTE: we use httpx + Twilio's REST API rather than the `twilio` SDK
because the SDK is sync. For outbound we want async to match the
rest of the FastAPI server.

Refs:
  * https://www.twilio.com/docs/voice/api/call-resource
"""

from __future__ import annotations

from typing import Any, Optional
from urllib.parse import urlencode

import httpx


class TwilioAPIError(Exception):
    def __init__(self, status: int, body: str):
        super().__init__(f"twilio {status}: {body[:200]}")
        self.status = status
        self.body = body


class TwilioOutboundClient:
    def __init__(
        self,
        account_sid: str,
        auth_token: str,
        from_number: str,
        public_base_url: str,
        timeout_s: float = 10.0,
        *,
        transport: httpx.AsyncBaseTransport | None = None,
        base_url: str = "https://api.twilio.com",
    ):
        if not account_sid or not auth_token or not from_number:
            raise RuntimeError(
                "Twilio outbound client requires account_sid, auth_token, "
                "and from_number."
            )
        if not public_base_url:
            raise RuntimeError(
                "PUBLIC_BASE_URL must be set so Twilio can fetch our TwiML."
            )
        self._account_sid = account_sid
        self._from_number = from_number
        self._public_base_url = public_base_url.rstrip("/")
        self._http = httpx.AsyncClient(
            base_url=base_url,
            auth=(account_sid, auth_token),
            timeout=timeout_s,
            transport=transport,
        )

    async def aclose(self) -> None:
        await self._http.aclose()

    def _voice_webhook_url(
        self,
        *,
        first_message: Optional[str],
        variables: dict[str, Any],
    ) -> str:
        """Build the URL Twilio fetches when the callee picks up.

        We funnel per-call overrides through query params so the
        inbound webhook can use them without us holding state.
        """
        params: dict[str, str] = {}
        if first_message:
            params["first_message"] = first_message
        for k, v in (variables or {}).items():
            # `var_` prefix to namespace caller-supplied keys away
            # from any future first-class param.
            params[f"var_{k}"] = str(v)
        url = f"{self._public_base_url}/twilio/voice"
        if params:
            url = f"{url}?{urlencode(params)}"
        return url

    async def create_call(
        self,
        *,
        to_number: str,
        first_message: Optional[str] = None,
        variables: Optional[dict[str, Any]] = None,
    ) -> dict[str, Any]:
        url = self._voice_webhook_url(
            first_message=first_message,
            variables=variables or {},
        )
        data = {
            "To": to_number,
            "From": self._from_number,
            "Url": url,
            "Method": "POST",
        }
        path = f"/2010-04-01/Accounts/{self._account_sid}/Calls.json"
        r = await self._http.post(
            path,
            data=data,  # Twilio's REST API uses form-encoded bodies.
        )
        if not r.is_success:
            raise TwilioAPIError(status=r.status_code, body=r.text)
        return r.json()
