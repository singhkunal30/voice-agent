"""Adapter between Pipecat's function-calling API and our ToolRegistry.

The registry stays the single source of truth for tool behavior:
schemas, validation, idempotency, voice-friendly error messages.
This module just translates Pipecat's `FunctionCallParams` to a
`registry.dispatch(name, args, call_id=...)` call and pipes the
result back through `params.result_callback`.

A ToolError raised inside the handler becomes a `{"error": "..."}`
payload, which the LLM speaks verbatim — matching the contract we
established for the inbound Vapi webhook.
"""

from __future__ import annotations

import logging
from typing import Any

from pipecat.adapters.schemas.function_schema import FunctionSchema
from pipecat.adapters.schemas.tools_schema import ToolsSchema
from pipecat.services.llm_service import FunctionCallParams, LLMService

from ..tools import ToolRegistry
from ..tools.errors import ToolError

log = logging.getLogger(__name__)


# Function schemas. Keep aligned with the Pydantic args models in
# `app/schemas/tool_args.py` — the LLM uses these to know what to
# pass; the Pydantic models re-validate when the call comes in, so
# they're a defense-in-depth check, not a source of truth.

_LOOKUP_ORDER_SCHEMA = FunctionSchema(
    name="lookup_order",
    description=(
        "Look up the status, estimated arrival, and items of a customer's "
        "order by ID. Use this only after the caller has given a specific "
        "order ID and you've confirmed it back to them."
    ),
    properties={
        "order_id": {
            "type": "string",
            "description": "The customer's order ID, e.g. 'ORD-1001'.",
        }
    },
    required=["order_id"],
)

_BOOK_APPOINTMENT_SCHEMA = FunctionSchema(
    name="book_appointment",
    description=(
        "Book an appointment after the caller has confirmed all four "
        "details: date, time, full name, and a phone or email. Slots "
        "are 30 minutes, weekdays 9 a.m.-5 p.m."
    ),
    properties={
        "date": {
            "type": "string",
            "description": "Appointment date in YYYY-MM-DD.",
        },
        "time": {
            "type": "string",
            "description": (
                "Appointment time in HH:MM (24-hour, on the hour or "
                "half hour)."
            ),
        },
        "customer_name": {
            "type": "string",
            "description": "Caller's full name.",
        },
        "contact": {
            "type": "string",
            "description": (
                "A phone number or email address to send confirmation to."
            ),
        },
    },
    required=["date", "time", "customer_name", "contact"],
)


def build_tools_schema() -> ToolsSchema:
    return ToolsSchema(
        standard_tools=[_LOOKUP_ORDER_SCHEMA, _BOOK_APPOINTMENT_SCHEMA]
    )


def _make_handler(registry: ToolRegistry, call_id: str | None):
    async def handler(params: FunctionCallParams) -> None:
        name = params.function_name
        args: dict[str, Any] = dict(params.arguments or {})
        try:
            speakable = await registry.dispatch(name, args, call_id=call_id)
            await params.result_callback({"result": speakable})
        except ToolError as exc:
            log.info(
                "tool error",
                extra={
                    "tool": name,
                    "code": exc.code,
                    "call_id": call_id,
                },
            )
            # Vapi-era contract preserved: errors are spoken to the
            # caller as-is, never surfaced as a transport failure.
            await params.result_callback({"error": exc.speakable})
        except Exception:  # pragma: no cover — defensive only
            log.exception(
                "unhandled tool exception",
                extra={"tool": name, "call_id": call_id},
            )
            await params.result_callback(
                {
                    "error": (
                        "Something went wrong on my end. "
                        "Could you try that again?"
                    )
                }
            )

    return handler


def register_tools(
    llm: LLMService,
    registry: ToolRegistry,
    *,
    call_id: str | None,
) -> None:
    """Wire all of the registry's tools onto the Pipecat LLM service."""
    handler = _make_handler(registry, call_id)
    for name in registry.names():
        llm.register_function(name, handler)
