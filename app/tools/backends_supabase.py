"""Supabase-backed `OrderBackend` and `CalendarBackend` implementations.

These match the Protocols in `backends.py` 1:1 so existing handlers,
tests, and the registry don't need to know which backend is wired up.

Schema lives in `migrations/0001_schema.sql`. Key invariants the
calendar backend relies on:

  * `appointments.idempotency_key` is UNIQUE — a retry of the same tool
    call returns the original confirmation instead of double-booking.
  * `appointments.starts_at` is UNIQUE — two concurrent callers cannot
    book the same slot.

Both invariants are enforced by Postgres, not Python, so we get the
right answer under concurrency even with multiple replicas. The
collision-vs-replay distinction is recovered from the SQLSTATE 23505
error detail (PostgREST surfaces the constraint name).
"""

from __future__ import annotations

import logging
import uuid
from datetime import date, datetime, time
from typing import Optional

from ..supabase_client import PostgresError, SupabaseClient
from .backends import Appointment, Order

log = logging.getLogger(__name__)


# ---------- Orders ----------


class SupabaseOrderBackend:
    def __init__(self, client: SupabaseClient):
        self._client = client

    async def get(self, order_id: str) -> Optional[Order]:
        # Match the in-memory backend's case-insensitive lookup.
        normalized = order_id.upper()
        row = await self._client.select_one(
            "orders",
            filters={"order_id": f"eq.{normalized}"},
            columns="order_id,status,eta,items",
        )
        if row is None:
            return None
        return Order(
            order_id=row["order_id"],
            status=row["status"],
            eta=row.get("eta"),
            items=list(row.get("items") or []),
        )


# ---------- Calendar ----------


def _is_business_slot(when: datetime) -> bool:
    """Mirror the in-memory backend's business rules.

    Kept in Python because they're UX rules, not security: we'd rather
    reject early with a friendly message than have Postgres raise an
    opaque constraint error.
    """
    if when.weekday() >= 5:
        return False
    if when.minute % 30 != 0 or when.second or when.microsecond:
        return False
    if when.hour < 9 or when.hour >= 17:
        return False
    return True


def _new_confirmation_id() -> str:
    return f"APT-{uuid.uuid4().hex[:8].upper()}"


class SupabaseCalendarBackend:
    def __init__(self, client: SupabaseClient):
        self._client = client

    async def is_available(self, when: datetime) -> bool:
        if not _is_business_slot(when):
            return False
        row = await self._client.select_one(
            "appointments",
            filters={"starts_at": f"eq.{when.isoformat()}"},
            columns="id",
        )
        return row is None

    async def book(
        self,
        when: datetime,
        customer_name: str,
        contact: str,
        idempotency_key: str,
    ) -> Appointment:
        # Replay shortcut: a prior tool call with this idempotency key
        # already produced a booking — return it as-is. The handler's
        # speakable result will be identical.
        existing = await self._client.select_one(
            "appointments",
            filters={"idempotency_key": f"eq.{idempotency_key}"},
            columns="confirmation_id,starts_at,customer_name,contact",
        )
        if existing is not None:
            return _row_to_appointment(existing)

        if not _is_business_slot(when):
            raise ValueError("slot_not_bookable")

        row = {
            "confirmation_id": _new_confirmation_id(),
            "starts_at": when.isoformat(),
            "customer_name": customer_name,
            "contact": contact,
            "idempotency_key": idempotency_key,
        }
        try:
            inserted = await self._client.insert("appointments", row)
        except PostgresError as exc:
            if not exc.is_unique_violation:
                raise
            # Recover by looking at *which* constraint tripped. PostgREST
            # surfaces the constraint name in `details`, e.g.
            # 'Key (idempotency_key)=(…) already exists.'
            detail = (exc.details or "").lower()
            if "idempotency_key" in detail:
                # A concurrent retry won the race; return its row.
                replayed = await self._client.select_one(
                    "appointments",
                    filters={"idempotency_key": f"eq.{idempotency_key}"},
                    columns="confirmation_id,starts_at,customer_name,contact",
                )
                if replayed is not None:
                    return _row_to_appointment(replayed)
                # Lost the race but the row isn't there — re-raise as a
                # generic failure so the caller speaks a friendly retry.
                raise
            if "starts_at" in detail:
                raise ValueError("slot_taken") from exc
            # Unknown unique constraint — surface as-is.
            raise

        return _row_to_appointment(inserted)


def _row_to_appointment(row: dict) -> Appointment:
    starts_at_raw = row["starts_at"]
    # PostgREST returns timestamp as ISO 8601 without a TZ for `timestamp`
    # columns and with a TZ for `timestamptz`. We use plain `timestamp`,
    # but accept either form to be safe.
    starts_at = datetime.fromisoformat(starts_at_raw.replace("Z", "+00:00"))
    appt_date: date = starts_at.date()
    appt_time: time = starts_at.time().replace(microsecond=0)
    return Appointment(
        confirmation_id=row["confirmation_id"],
        date=appt_date,
        time=appt_time,
        customer_name=row["customer_name"],
        contact=row["contact"],
    )
