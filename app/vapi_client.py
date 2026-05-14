"""Async Vapi API client.

Used by the outbound endpoint. The provisioning CLI in `assistant.py`
uses its own sync client because it's run from the terminal — there's
no benefit to async there. This module is for in-request use from
FastAPI.

Refs (verified May 2026):
  * https://docs.vapi.ai/api-reference/calls/create — POST /call
  * https://docs.vapi.ai/calls/outbound-calling
  * https://docs.vapi.ai/assistants/dynamic-variables — {{var}} templating
"""

from __future__ import annotations

from typing import Any, Optional

import httpx


class VapiAPIError(Exception):
    """A non-2xx response from the Vapi REST API."""

    def __init__(self, status: int, body: str):
        super().__init__(f"vapi {status}: {body[:200]}")
        self.status = status
        self.body = body


class VapiClient:
    def __init__(
        self,
        api_key: str,
        base_url: str = "https://api.vapi.ai",
        timeout_s: float = 10.0,
        *,
        transport: httpx.AsyncBaseTransport | None = None,
    ):
        if not api_key:
            raise RuntimeError(
                "VAPI_API_KEY is empty — cannot call the Vapi API."
            )
        self._http = httpx.AsyncClient(
            base_url=base_url.rstrip("/"),
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            timeout=timeout_s,
            transport=transport,
        )

    async def aclose(self) -> None:
        await self._http.aclose()

    async def create_phone_call(
        self,
        *,
        assistant_id: str,
        phone_number_id: str,
        to_number: str,
        first_message: Optional[str] = None,
        variables: Optional[dict[str, Any]] = None,
        customer_name: Optional[str] = None,
    ) -> dict[str, Any]:
        """Place an outbound phone call.

        `first_message` may contain `{{var}}` placeholders; Vapi
        substitutes them from `variables`. Everything in `variables`
        is also exposed to the assistant's prompt via the same
        templating mechanism, so dynamic context (order ID, customer
        name) belongs there.
        """
        payload: dict[str, Any] = {
            "assistantId": assistant_id,
            "phoneNumberId": phone_number_id,
            "customer": {"number": to_number},
        }
        if customer_name:
            payload["customer"]["name"] = customer_name

        overrides: dict[str, Any] = {}
        if first_message is not None:
            overrides["firstMessage"] = first_message
        if variables:
            overrides["variableValues"] = variables
        if overrides:
            payload["assistantOverrides"] = overrides

        r = await self._http.post("/call", json=payload)
        if not r.is_success:
            raise VapiAPIError(status=r.status_code, body=r.text)
        return r.json()
