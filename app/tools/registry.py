"""Tool dispatch.

The registry maps a Vapi tool name to (a) a Pydantic args model and (b)
an async handler. The webhook layer doesn't know about specific tools;
it just calls `registry.dispatch(name, raw_args, call_id=...)`.

This keeps tool implementations testable without spinning up FastAPI.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any, Awaitable, Callable

from pydantic import BaseModel, ValidationError

from ..schemas.tool_args import BookAppointmentArgs, LookupOrderArgs
from .backends import (
    CalendarBackend,
    InMemoryCalendarBackend,
    InMemoryOrderBackend,
    OrderBackend,
)
from .errors import ToolError
from .handlers import book_appointment, lookup_order

log = logging.getLogger(__name__)

HandlerFn = Callable[..., Awaitable[str]]


@dataclass
class ToolSpec:
    name: str
    args_model: type[BaseModel]
    handler: HandlerFn


class ToolRegistry:
    def __init__(
        self,
        order_backend: OrderBackend,
        calendar_backend: CalendarBackend,
        external_timeout_s: float = 5.0,
    ) -> None:
        self._order_backend = order_backend
        self._calendar_backend = calendar_backend
        self._timeout_s = external_timeout_s

        self._tools: dict[str, ToolSpec] = {
            "lookup_order": ToolSpec(
                name="lookup_order",
                args_model=LookupOrderArgs,
                handler=self._lookup_order,
            ),
            "book_appointment": ToolSpec(
                name="book_appointment",
                args_model=BookAppointmentArgs,
                handler=self._book_appointment,
            ),
        }

    def names(self) -> list[str]:
        return list(self._tools)

    async def dispatch(
        self,
        name: str,
        raw_args: dict[str, Any],
        *,
        call_id: str | None = None,
    ) -> str:
        spec = self._tools.get(name)
        if spec is None:
            raise ToolError(
                f"I don't know how to do that ({name}).",
                code="unknown_tool",
            )

        try:
            args = spec.args_model.model_validate(raw_args)
        except ValidationError as exc:
            log.info(
                "tool args validation failed",
                extra={"tool": name, "errors": exc.errors()},
            )
            # Pick the first error and speak something humans understand.
            first = exc.errors()[0]
            field = ".".join(str(p) for p in first.get("loc", ()))
            raise ToolError(
                f"I didn't catch a valid value for {field or 'one of the details'}. "
                "Could you say that again?",
                code="invalid_args",
            ) from exc

        return await spec.handler(args, call_id=call_id)

    async def _lookup_order(self, args: LookupOrderArgs, *, call_id: str | None) -> str:
        return await lookup_order(
            args, backend=self._order_backend, timeout_s=self._timeout_s
        )

    async def _book_appointment(
        self, args: BookAppointmentArgs, *, call_id: str | None
    ) -> str:
        return await book_appointment(
            args,
            backend=self._calendar_backend,
            timeout_s=self._timeout_s,
            call_id=call_id,
        )


def build_default_registry(external_timeout_s: float = 5.0) -> ToolRegistry:
    return ToolRegistry(
        order_backend=InMemoryOrderBackend(),
        calendar_backend=InMemoryCalendarBackend(),
        external_timeout_s=external_timeout_s,
    )


async def _noop_aclose() -> None:
    return None


def build_registry_from_settings(settings) -> tuple[ToolRegistry, "object"]:
    """Pick a registry based on environment.

    Returns `(registry, aclose_coroutine_fn)`. The caller is responsible
    for awaiting `aclose_coroutine_fn()` on shutdown — important for
    Supabase, which holds an httpx connection pool.
    """
    if settings.supabase_url and settings.supabase_service_role_key:
        # Imported lazily so the in-memory path stays a zero-dep import.
        from ..supabase_client import SupabaseClient
        from .backends_supabase import (
            SupabaseCalendarBackend,
            SupabaseOrderBackend,
        )

        client = SupabaseClient(
            url=settings.supabase_url,
            service_role_key=settings.supabase_service_role_key,
            timeout_s=settings.external_call_timeout_s,
        )
        registry = ToolRegistry(
            order_backend=SupabaseOrderBackend(client),
            calendar_backend=SupabaseCalendarBackend(client),
            external_timeout_s=settings.external_call_timeout_s,
        )
        return registry, client.aclose

    return build_default_registry(settings.external_call_timeout_s), _noop_aclose
