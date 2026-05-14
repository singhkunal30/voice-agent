"""Voice-tool handler implementations.

Each handler:
- Accepts a validated Pydantic args model.
- Returns a short, voice-friendly string (the assistant reads it aloud).
- Raises `ToolError` for expected failures with a spoken message.
- Times out external calls; never blocks forever.
"""

from __future__ import annotations

import asyncio
import hashlib
import logging
from datetime import datetime

from ..schemas.tool_args import BookAppointmentArgs, LookupOrderArgs
from .backends import CalendarBackend, OrderBackend
from .errors import ToolError

log = logging.getLogger(__name__)


def _format_items(items: list[str]) -> str:
    if not items:
        return "no items"
    if len(items) == 1:
        return items[0]
    if len(items) == 2:
        return f"{items[0]} and {items[1]}"
    return ", ".join(items[:-1]) + f", and {items[-1]}"


async def lookup_order(
    args: LookupOrderArgs,
    *,
    backend: OrderBackend,
    timeout_s: float,
) -> str:
    try:
        order = await asyncio.wait_for(backend.get(args.order_id), timeout=timeout_s)
    except asyncio.TimeoutError as exc:
        log.warning("lookup_order timeout", extra={"order_id": args.order_id})
        raise ToolError(
            "I couldn't reach the order system in time. Please try again in a moment.",
            code="upstream_timeout",
        ) from exc

    if order is None:
        raise ToolError(
            f"I couldn't find an order with ID {args.order_id}. "
            "Could you double-check the number?",
            code="not_found",
        )

    items = _format_items(order.items)
    if order.status == "delivered":
        return f"Order {order.order_id} was delivered. It contained {items}."
    if order.eta:
        return (
            f"Order {order.order_id} is {order.status}. "
            f"Estimated arrival is {order.eta}. It contains {items}."
        )
    return f"Order {order.order_id} is {order.status}. It contains {items}."


def _idempotency_key(args: BookAppointmentArgs, call_id: str | None) -> str:
    """Derive a stable key so retried webhooks don't double-book.

    The key intentionally folds in the call ID when present — a true retry
    of the same tool call within the same call will collide; a fresh call
    asking for the same slot will not.
    """
    raw = "|".join(
        [
            call_id or "no-call",
            args.date.isoformat(),
            args.time.isoformat(),
            args.customer_name.lower().strip(),
            args.contact.lower().strip(),
        ]
    )
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


async def book_appointment(
    args: BookAppointmentArgs,
    *,
    backend: CalendarBackend,
    timeout_s: float,
    call_id: str | None = None,
) -> str:
    when = datetime.combine(args.date, args.time)
    key = _idempotency_key(args, call_id)

    # The backend is the source of truth for both availability and
    # idempotency — a replay of the same key returns the same booking
    # even if the slot now appears "taken". A separate is_available
    # pre-check would race against the booking it just made.
    try:
        appt = await asyncio.wait_for(
            backend.book(
                when=when,
                customer_name=args.customer_name,
                contact=args.contact,
                idempotency_key=key,
            ),
            timeout=timeout_s,
        )
    except asyncio.TimeoutError as exc:
        raise ToolError(
            "I couldn't confirm the booking in time. Please try again shortly.",
            code="upstream_timeout",
        ) from exc
    except ValueError as exc:
        if str(exc) == "slot_taken":
            raise ToolError(
                f"Sorry, {args.time.strftime('%I:%M %p').lstrip('0')} on "
                f"{args.date.strftime('%A, %B %d')} is already booked. "
                "Want to try a different time?",
                code="slot_taken",
            ) from exc
        raise ToolError(
            "That time isn't bookable. Could you pick a weekday between "
            "9 a.m. and 5 p.m., on the hour or half hour?",
            code="slot_not_bookable",
        ) from exc

    return (
        f"You're booked for {appt.date.strftime('%A, %B %d')} at "
        f"{appt.time.strftime('%I:%M %p').lstrip('0')}. "
        f"Your confirmation code is {appt.confirmation_id}."
    )
