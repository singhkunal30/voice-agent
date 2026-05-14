"""Assistant provisioning against the Vapi REST API.

Refs (verified May 2026):
- https://docs.vapi.ai/api-reference/assistants/create — POST /assistant
- https://docs.vapi.ai/api-reference/assistants/update — PATCH /assistant/:id
- https://docs.vapi.ai/tools/custom-tools — tool schema + server URL

The shape below is a sensible default for a US English inbound voice
agent. Voice, transcriber, and model fields are well-typed enums in the
Vapi API; if you change them, validate against the docs first.
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import sys
from pathlib import Path
from typing import Any

import httpx

from .config import get_settings

log = logging.getLogger(__name__)

ASSISTANT_NAME = "Acme Voice Agent"
PROMPT_FILE = Path(__file__).resolve().parent.parent / "prompts" / "system_prompt_v1.md"


def _load_prompt() -> str:
    return PROMPT_FILE.read_text(encoding="utf-8").strip()


def _tool_definitions(server_url: str, server_secret: str) -> list[dict[str, Any]]:
    """The tool list we attach to the assistant.

    `server.url` and `server.secret` tell Vapi where to POST tool calls
    and what secret to send so we can authenticate the webhook.
    """
    server = {"url": server_url, "secret": server_secret}
    return [
        {
            "type": "function",
            "function": {
                "name": "lookup_order",
                "description": (
                    "Look up the status, estimated arrival, and items of a "
                    "customer's order by ID. Use this only after the caller "
                    "has given you a specific order ID and you've confirmed it."
                ),
                "parameters": {
                    "type": "object",
                    "properties": {
                        "order_id": {
                            "type": "string",
                            "description": (
                                "The customer's order ID, e.g. 'ORD-1001'."
                            ),
                        }
                    },
                    "required": ["order_id"],
                },
            },
            "server": server,
        },
        {
            "type": "function",
            "function": {
                "name": "book_appointment",
                "description": (
                    "Book an appointment after the caller has confirmed all "
                    "four details: date, time, full name, and a phone or email. "
                    "Slots are 30 minutes, weekdays 9 a.m.–5 p.m."
                ),
                "parameters": {
                    "type": "object",
                    "properties": {
                        "date": {
                            "type": "string",
                            "format": "date",
                            "description": "Appointment date in YYYY-MM-DD.",
                        },
                        "time": {
                            "type": "string",
                            "description": (
                                "Appointment time in HH:MM (24-hour, on the "
                                "hour or half hour)."
                            ),
                        },
                        "customer_name": {
                            "type": "string",
                            "description": "Caller's full name.",
                        },
                        "contact": {
                            "type": "string",
                            "description": (
                                "A phone number or email address to send "
                                "confirmation to."
                            ),
                        },
                    },
                    "required": ["date", "time", "customer_name", "contact"],
                },
            },
            "server": server,
        },
    ]


def build_assistant_config(server_url: str, server_secret: str) -> dict[str, Any]:
    return {
        "name": ASSISTANT_NAME,
        "firstMessage": (
            "Hi, thanks for calling Acme. I can help you check an order or "
            "book an appointment — which would you like?"
        ),
        "transcriber": {
            "provider": "deepgram",
            "model": "nova-2",
            "language": "en-US",
        },
        "model": {
            "provider": "openai",
            "model": "gpt-4o-mini",
            "temperature": 0.3,
            "messages": [
                {"role": "system", "content": _load_prompt()},
            ],
            "tools": _tool_definitions(server_url, server_secret),
        },
        "voice": {
            "provider": "11labs",
            "voiceId": "burt",
        },
        "silenceTimeoutSeconds": 20,
        "maxDurationSeconds": 600,
        "endCallPhrases": ["goodbye", "bye bye", "have a good day"],
        "server": {
            # End-of-call reports and status events go to the same URL;
            # the webhook handler ignores anything that isn't a tool-call.
            "url": server_url,
            "secret": server_secret,
        },
    }


class VapiClient:
    def __init__(self, api_key: str, base_url: str):
        if not api_key:
            raise RuntimeError(
                "VAPI_API_KEY is not set — cannot call the Vapi API."
            )
        self._client = httpx.Client(
            base_url=base_url,
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            timeout=15.0,
        )

    def close(self) -> None:
        self._client.close()

    def create_assistant(self, config: dict[str, Any]) -> dict[str, Any]:
        r = self._client.post("/assistant", json=config)
        r.raise_for_status()
        return r.json()

    def update_assistant(
        self, assistant_id: str, config: dict[str, Any]
    ) -> dict[str, Any]:
        r = self._client.patch(f"/assistant/{assistant_id}", json=config)
        r.raise_for_status()
        return r.json()

    def attach_phone_number(
        self, phone_number_id: str, assistant_id: str
    ) -> dict[str, Any]:
        r = self._client.patch(
            f"/phone-number/{phone_number_id}",
            json={"assistantId": assistant_id},
        )
        r.raise_for_status()
        return r.json()


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Create or update the Vapi assistant for this voice agent."
    )
    parser.add_argument(
        "--server-url",
        required=True,
        help="Public HTTPS URL of /vapi/webhook (e.g. https://abc.ngrok.app/vapi/webhook).",
    )
    parser.add_argument(
        "--assistant-id",
        default=None,
        help="If set, PATCH this assistant instead of creating a new one.",
    )
    parser.add_argument(
        "--attach-phone",
        action="store_true",
        help="Also bind the assistant to VAPI_PHONE_NUMBER_ID.",
    )
    args = parser.parse_args(argv)

    settings = get_settings()
    if not settings.vapi_server_secret:
        print(
            "VAPI_SERVER_SECRET is empty; the webhook would accept any request. "
            "Refusing to provision.",
            file=sys.stderr,
        )
        return 2

    config = build_assistant_config(
        server_url=args.server_url,
        server_secret=settings.vapi_server_secret,
    )

    client = VapiClient(settings.vapi_api_key, settings.vapi_api_base)
    try:
        if args.assistant_id:
            result = client.update_assistant(args.assistant_id, config)
            assistant_id = result.get("id", args.assistant_id)
            print(f"Updated assistant {assistant_id}")
        else:
            result = client.create_assistant(config)
            assistant_id = result["id"]
            print(f"Created assistant {assistant_id}")

        if args.attach_phone:
            if not settings.vapi_phone_number_id:
                print(
                    "VAPI_PHONE_NUMBER_ID is empty; cannot --attach-phone.",
                    file=sys.stderr,
                )
                return 2
            client.attach_phone_number(
                settings.vapi_phone_number_id, assistant_id
            )
            print(
                f"Bound phone number {settings.vapi_phone_number_id} -> "
                f"assistant {assistant_id}"
            )
    except httpx.HTTPStatusError as exc:
        print(
            f"Vapi API error {exc.response.status_code}: {exc.response.text}",
            file=sys.stderr,
        )
        return 1
    finally:
        client.close()

    print(json.dumps({"assistant_id": assistant_id}))
    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
