"""Tests for the Supabase-backed order and calendar backends.

We don't talk to a real Supabase. Instead we stand up the
`SupabaseClient` against an `httpx.MockTransport` that emulates
PostgREST: dispatching by `(method, path)`, parsing simple `eq.*`
filters, and replaying canned rows. That gives us coverage of the
unique-violation recovery paths (idempotency replay vs slot collision)
without needing the real DB.
"""

from __future__ import annotations

import json
from datetime import date, datetime, time, timedelta
from typing import Callable
from urllib.parse import parse_qs

import httpx
import pytest

from app.supabase_client import SupabaseClient
from app.tools.backends_supabase import (
    SupabaseCalendarBackend,
    SupabaseOrderBackend,
)


# ---------- mock transport helpers ----------


def _eq_filter(value: str) -> str:
    # PostgREST sends filters like ?col=eq.VALUE — return just VALUE.
    return value.split("eq.", 1)[1] if value.startswith("eq.") else value


def _make_client(handler: Callable[[httpx.Request], httpx.Response]) -> SupabaseClient:
    return SupabaseClient(
        url="https://stub.supabase.co",
        service_role_key="stub-key",
        timeout_s=2.0,
        transport=httpx.MockTransport(handler),
    )


def _next_weekday() -> date:
    d = date.today() + timedelta(days=1)
    while d.weekday() >= 5:
        d += timedelta(days=1)
    return d


# ---------- orders ----------


async def test_supabase_order_found():
    def handler(req: httpx.Request) -> httpx.Response:
        assert req.method == "GET"
        assert req.url.path == "/rest/v1/orders"
        qs = parse_qs(req.url.query.decode())
        assert _eq_filter(qs["order_id"][0]) == "ORD-1001"
        return httpx.Response(
            200,
            json=[
                {
                    "order_id": "ORD-1001",
                    "status": "shipped",
                    "eta": "2026-05-16",
                    "items": ["Acme Widget"],
                }
            ],
        )

    client = _make_client(handler)
    try:
        backend = SupabaseOrderBackend(client)
        # Case-insensitive lookup must be preserved.
        order = await backend.get("ord-1001")
        assert order is not None
        assert order.order_id == "ORD-1001"
        assert order.status == "shipped"
        assert order.items == ["Acme Widget"]
    finally:
        await client.aclose()


async def test_supabase_order_not_found():
    def handler(req: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=[])

    client = _make_client(handler)
    try:
        backend = SupabaseOrderBackend(client)
        assert await backend.get("ORD-9999") is None
    finally:
        await client.aclose()


# ---------- calendar: happy path ----------


async def test_supabase_book_inserts_new_appointment():
    when = datetime.combine(_next_weekday(), time(10, 0))

    def handler(req: httpx.Request) -> httpx.Response:
        if req.method == "GET" and req.url.path == "/rest/v1/appointments":
            # Pre-flight idempotency check returns no prior row.
            return httpx.Response(200, json=[])
        if req.method == "POST" and req.url.path == "/rest/v1/appointments":
            body = json.loads(req.content)
            return httpx.Response(
                201,
                json=[
                    {
                        "confirmation_id": "APT-ABCDEFAB",
                        "starts_at": body["starts_at"],
                        "customer_name": body["customer_name"],
                        "contact": body["contact"],
                    }
                ],
            )
        raise AssertionError(f"unexpected {req.method} {req.url}")

    client = _make_client(handler)
    try:
        backend = SupabaseCalendarBackend(client)
        appt = await backend.book(
            when=when,
            customer_name="Jane Doe",
            contact="+1 415 555 0100",
            idempotency_key="key-1",
        )
        assert appt.confirmation_id == "APT-ABCDEFAB"
        assert appt.date == when.date()
        assert appt.time == when.time()
    finally:
        await client.aclose()


# ---------- calendar: idempotency replays ----------


async def test_supabase_book_replays_existing_idempotency_key():
    when = datetime.combine(_next_weekday(), time(11, 0))

    def handler(req: httpx.Request) -> httpx.Response:
        if req.method == "GET":
            return httpx.Response(
                200,
                json=[
                    {
                        "confirmation_id": "APT-EXIST01",
                        "starts_at": when.isoformat(),
                        "customer_name": "Jane Doe",
                        "contact": "+1 415 555 0100",
                    }
                ],
            )
        raise AssertionError("must not POST when replaying")

    client = _make_client(handler)
    try:
        backend = SupabaseCalendarBackend(client)
        appt = await backend.book(
            when=when,
            customer_name="Jane Doe",
            contact="+1 415 555 0100",
            idempotency_key="replay-key",
        )
        assert appt.confirmation_id == "APT-EXIST01"
    finally:
        await client.aclose()


async def test_supabase_book_recovers_from_concurrent_idempotency_race():
    """SELECT returns empty, INSERT loses the race — backend must SELECT again."""
    when = datetime.combine(_next_weekday(), time(13, 0))
    state = {"get_count": 0}

    def handler(req: httpx.Request) -> httpx.Response:
        if req.method == "GET":
            state["get_count"] += 1
            if state["get_count"] == 1:
                return httpx.Response(200, json=[])
            return httpx.Response(
                200,
                json=[
                    {
                        "confirmation_id": "APT-WINNER1",
                        "starts_at": when.isoformat(),
                        "customer_name": "Jane Doe",
                        "contact": "jane@example.com",
                    }
                ],
            )
        if req.method == "POST":
            return httpx.Response(
                409,
                json={
                    "code": "23505",
                    "message": (
                        'duplicate key value violates unique constraint '
                        '"appointments_idempotency_key_key"'
                    ),
                    "details": (
                        "Key (idempotency_key)=(race-key) already exists."
                    ),
                    "hint": None,
                },
            )
        raise AssertionError(f"unexpected {req.method}")

    client = _make_client(handler)
    try:
        backend = SupabaseCalendarBackend(client)
        appt = await backend.book(
            when=when,
            customer_name="Jane Doe",
            contact="jane@example.com",
            idempotency_key="race-key",
        )
        assert appt.confirmation_id == "APT-WINNER1"
        assert state["get_count"] == 2  # pre-flight + post-race recovery
    finally:
        await client.aclose()


# ---------- calendar: collisions ----------


async def test_supabase_book_slot_taken_raises_value_error():
    when = datetime.combine(_next_weekday(), time(14, 0))

    def handler(req: httpx.Request) -> httpx.Response:
        if req.method == "GET":
            return httpx.Response(200, json=[])
        if req.method == "POST":
            return httpx.Response(
                409,
                json={
                    "code": "23505",
                    "message": (
                        'duplicate key value violates unique constraint '
                        '"appointments_starts_at_unique"'
                    ),
                    "details": (
                        f"Key (starts_at)=({when.isoformat()}) already exists."
                    ),
                    "hint": None,
                },
            )
        raise AssertionError("unexpected")

    client = _make_client(handler)
    try:
        backend = SupabaseCalendarBackend(client)
        with pytest.raises(ValueError, match="slot_taken"):
            await backend.book(
                when=when,
                customer_name="Other Person",
                contact="+1 415 555 0199",
                idempotency_key="fresh-key",
            )
    finally:
        await client.aclose()


# ---------- calendar: business rules ----------


async def test_supabase_book_rejects_off_hours_before_insert():
    when = datetime.combine(_next_weekday(), time(7, 0))  # before opening

    def handler(req: httpx.Request) -> httpx.Response:
        if req.method == "GET":
            return httpx.Response(200, json=[])
        raise AssertionError(
            "off-hours slot must be rejected without an INSERT"
        )

    client = _make_client(handler)
    try:
        backend = SupabaseCalendarBackend(client)
        with pytest.raises(ValueError, match="slot_not_bookable"):
            await backend.book(
                when=when,
                customer_name="Jane Doe",
                contact="jane@example.com",
                idempotency_key="off-hours",
            )
    finally:
        await client.aclose()


async def test_supabase_is_available_false_for_weekend():
    # Find Saturday.
    d = date.today()
    while d.weekday() != 5:
        d += timedelta(days=1)
    when = datetime.combine(d, time(10, 0))

    def handler(req: httpx.Request) -> httpx.Response:
        raise AssertionError("weekend availability must short-circuit")

    client = _make_client(handler)
    try:
        backend = SupabaseCalendarBackend(client)
        assert await backend.is_available(when) is False
    finally:
        await client.aclose()


# ---------- end-to-end: registry + handler over Supabase backends ----------


async def test_supabase_registry_lookup_order_speakable():
    from app.tools.registry import ToolRegistry

    def handler(req: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json=[
                {
                    "order_id": "ORD-1001",
                    "status": "shipped",
                    "eta": "2026-05-16",
                    "items": ["Acme Widget", "Acme Sprocket"],
                }
            ],
        )

    client = _make_client(handler)
    try:
        registry = ToolRegistry(
            order_backend=SupabaseOrderBackend(client),
            calendar_backend=SupabaseCalendarBackend(client),
            external_timeout_s=2.0,
        )
        out = await registry.dispatch("lookup_order", {"order_id": "ORD-1001"})
        assert "ORD-1001" in out
        assert "shipped" in out
        assert "Acme Widget" in out
    finally:
        await client.aclose()
