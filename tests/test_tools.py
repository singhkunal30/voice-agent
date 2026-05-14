from datetime import date, time, timedelta

import pytest

from app.tools import build_default_registry
from app.tools.errors import ToolError


def _next_weekday(d: date) -> date:
    while d.weekday() >= 5:
        d += timedelta(days=1)
    return d


@pytest.fixture
def registry():
    return build_default_registry(external_timeout_s=1.0)


# ---------- lookup_order ----------


async def test_lookup_order_success(registry):
    out = await registry.dispatch("lookup_order", {"order_id": "ORD-1001"})
    assert "ORD-1001" in out
    assert "shipped" in out
    assert "Acme Widget" in out


async def test_lookup_order_case_insensitive(registry):
    out = await registry.dispatch("lookup_order", {"order_id": "ord-1003"})
    assert "delivered" in out.lower()


async def test_lookup_order_not_found(registry):
    with pytest.raises(ToolError) as exc:
        await registry.dispatch("lookup_order", {"order_id": "ORD-9999"})
    assert exc.value.code == "not_found"


async def test_lookup_order_bad_input(registry):
    with pytest.raises(ToolError) as exc:
        await registry.dispatch("lookup_order", {"order_id": "!!"})
    assert exc.value.code == "invalid_args"


async def test_lookup_order_missing_arg(registry):
    with pytest.raises(ToolError) as exc:
        await registry.dispatch("lookup_order", {})
    assert exc.value.code == "invalid_args"


# ---------- book_appointment ----------


def _booking_args(d: date | None = None, hour: int = 10) -> dict:
    target = _next_weekday(d or (date.today() + timedelta(days=1)))
    return {
        "date": target.isoformat(),
        "time": time(hour, 0).isoformat(),
        "customer_name": "Jane Doe",
        "contact": "+1 415 555 0100",
    }


async def test_book_appointment_success(registry):
    out = await registry.dispatch("book_appointment", _booking_args(), call_id="c1")
    assert "confirmation" in out.lower()
    assert "APT-" in out


async def test_book_appointment_email_contact(registry):
    args = _booking_args(hour=11)
    args["contact"] = "jane@example.com"
    out = await registry.dispatch("book_appointment", args, call_id="c2")
    assert "APT-" in out


async def test_book_appointment_idempotent_within_call(registry):
    args = _booking_args(hour=13)
    first = await registry.dispatch("book_appointment", args, call_id="dup-call")
    second = await registry.dispatch("book_appointment", args, call_id="dup-call")
    # Same confirmation ID — the retry did not create a second booking.
    assert first == second


async def test_book_appointment_slot_taken(registry):
    args = _booking_args(hour=14)
    await registry.dispatch("book_appointment", args, call_id="call-A")
    with pytest.raises(ToolError) as exc:
        await registry.dispatch("book_appointment", args, call_id="call-B")
    assert exc.value.code == "slot_taken"


async def test_book_appointment_weekend_rejected(registry):
    # Find next Saturday.
    d = date.today()
    while d.weekday() != 5:
        d += timedelta(days=1)
    args = _booking_args(hour=10)
    args["date"] = d.isoformat()
    with pytest.raises(ToolError) as exc:
        await registry.dispatch("book_appointment", args, call_id="weekend")
    assert exc.value.code in {"slot_unavailable", "slot_not_bookable"}


async def test_book_appointment_bad_time(registry):
    args = _booking_args(hour=10)
    args["time"] = "10:17"  # not a 30-min slot
    with pytest.raises(ToolError) as exc:
        await registry.dispatch("book_appointment", args, call_id="bad-time")
    assert exc.value.code in {"slot_unavailable", "slot_not_bookable"}


async def test_book_appointment_invalid_contact(registry):
    args = _booking_args(hour=15)
    args["contact"] = "not a contact"
    with pytest.raises(ToolError) as exc:
        await registry.dispatch("book_appointment", args, call_id="bad-contact")
    assert exc.value.code == "invalid_args"


async def test_dispatch_unknown_tool(registry):
    with pytest.raises(ToolError) as exc:
        await registry.dispatch("nope", {})
    assert exc.value.code == "unknown_tool"
