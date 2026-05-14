"""Backend interfaces + in-memory fakes.

Real deployments wire these to a database, ERP, and calendar system.
Both fakes are deliberately simple but thread-safe enough for the
single-process FastAPI server.
"""

from __future__ import annotations

import asyncio
import uuid
from dataclasses import dataclass, field
from datetime import date, datetime, time, timedelta
from typing import Optional, Protocol


@dataclass(frozen=True)
class Order:
    order_id: str
    status: str
    eta: Optional[str]
    items: list[str]


@dataclass(frozen=True)
class Appointment:
    confirmation_id: str
    date: date
    time: time
    customer_name: str
    contact: str


class OrderBackend(Protocol):
    async def get(self, order_id: str) -> Optional[Order]: ...


class CalendarBackend(Protocol):
    async def is_available(self, when: datetime) -> bool: ...

    async def book(
        self,
        when: datetime,
        customer_name: str,
        contact: str,
        idempotency_key: str,
    ) -> Appointment: ...


# ---------- In-memory fakes ----------


class InMemoryOrderBackend:
    def __init__(self) -> None:
        today = date.today()
        eta_soon = (today + timedelta(days=2)).isoformat()
        eta_later = (today + timedelta(days=5)).isoformat()
        self._orders: dict[str, Order] = {
            "ORD-1001": Order(
                order_id="ORD-1001",
                status="shipped",
                eta=eta_soon,
                items=["Acme Widget", "Acme Sprocket"],
            ),
            "ORD-1002": Order(
                order_id="ORD-1002",
                status="processing",
                eta=eta_later,
                items=["Acme Gizmo"],
            ),
            "ORD-1003": Order(
                order_id="ORD-1003",
                status="delivered",
                eta=None,
                items=["Acme Doohickey"],
            ),
        }

    async def get(self, order_id: str) -> Optional[Order]:
        # Simulate a small I/O delay.
        await asyncio.sleep(0)
        return self._orders.get(order_id.upper())


@dataclass
class _SlotKey:
    when: datetime

    def key(self) -> str:
        return self.when.replace(second=0, microsecond=0).isoformat()


@dataclass
class InMemoryCalendarBackend:
    """A calendar with 30-minute slots from 09:00 to 17:00 on weekdays."""

    open_hour: int = 9
    close_hour: int = 17
    slot_minutes: int = 30
    _bookings: dict[str, Appointment] = field(default_factory=dict)
    _by_idempotency: dict[str, Appointment] = field(default_factory=dict)
    _lock: asyncio.Lock = field(default_factory=asyncio.Lock)

    def _is_business_slot(self, when: datetime) -> bool:
        if when.weekday() >= 5:
            return False
        if when.minute % self.slot_minutes != 0 or when.second or when.microsecond:
            return False
        if when.hour < self.open_hour or when.hour >= self.close_hour:
            return False
        return True

    async def is_available(self, when: datetime) -> bool:
        if not self._is_business_slot(when):
            return False
        return _SlotKey(when).key() not in self._bookings

    async def book(
        self,
        when: datetime,
        customer_name: str,
        contact: str,
        idempotency_key: str,
    ) -> Appointment:
        async with self._lock:
            # Idempotency: replaying the same key returns the same booking,
            # even if a different slot was requested. This matches typical
            # webhook-retry semantics.
            existing = self._by_idempotency.get(idempotency_key)
            if existing is not None:
                return existing

            if not self._is_business_slot(when):
                raise ValueError("slot_not_bookable")
            slot_key = _SlotKey(when).key()
            if slot_key in self._bookings:
                raise ValueError("slot_taken")

            appt = Appointment(
                confirmation_id=f"APT-{uuid.uuid4().hex[:8].upper()}",
                date=when.date(),
                time=when.time(),
                customer_name=customer_name,
                contact=contact,
            )
            self._bookings[slot_key] = appt
            self._by_idempotency[idempotency_key] = appt
            return appt
