#!/usr/bin/env python3
"""Trigger an outbound call against a running server.

Reads OUTBOUND_API_KEY from the environment for auth. With --dry-run,
prints the request payload without sending — useful for verifying
templating before you actually dial a phone.

Examples:

    # Plain dial
    python scripts/trigger_outbound.py --to +14155550100

    # Order-followup with templated firstMessage
    python scripts/trigger_outbound.py \
        --to +14155550100 \
        --first-message 'Hi {{customer_name}}, calling about order {{order_id}}.' \
        --var customer_name='Jane Doe' \
        --var order_id=ORD-1001 \
        --reason order_followup \
        --idempotency-key followup-ORD-1001
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from typing import Any

import httpx


def _parse_var(s: str) -> tuple[str, str]:
    if "=" not in s:
        raise argparse.ArgumentTypeError(
            f"--var expects name=value, got: {s}"
        )
    k, _, v = s.partition("=")
    if not k:
        raise argparse.ArgumentTypeError("variable name cannot be empty")
    return k, v


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--url", default="http://127.0.0.1:8000/outbound/call")
    p.add_argument("--to", required=True, help="Destination number (E.164).")
    p.add_argument("--first-message", default=None)
    p.add_argument("--customer-name", default=None)
    p.add_argument("--reason", default=None)
    p.add_argument("--idempotency-key", default=None)
    p.add_argument("--assistant-id", default=None)
    p.add_argument("--phone-number-id", default=None)
    p.add_argument(
        "--var",
        action="append",
        type=_parse_var,
        default=[],
        help="Repeatable: --var name=value. Substituted into firstMessage and prompt.",
    )
    p.add_argument(
        "--dry-run",
        action="store_true",
        help="Print the request body and exit without calling the server.",
    )
    args = p.parse_args()

    body: dict[str, Any] = {"to": args.to}
    if args.first_message:
        body["first_message"] = args.first_message
    if args.customer_name:
        body["customer_name"] = args.customer_name
    if args.reason:
        body["reason"] = args.reason
    if args.idempotency_key:
        body["idempotency_key"] = args.idempotency_key
    if args.assistant_id:
        body["assistant_id"] = args.assistant_id
    if args.phone_number_id:
        body["phone_number_id"] = args.phone_number_id
    if args.var:
        body["variables"] = dict(args.var)

    if args.dry_run:
        print(json.dumps(body, indent=2))
        return 0

    token = os.environ.get("OUTBOUND_API_KEY", "")
    if not token:
        print("OUTBOUND_API_KEY env var is required", file=sys.stderr)
        return 2

    r = httpx.post(
        args.url,
        json=body,
        headers={"Authorization": f"Bearer {token}"},
        timeout=15.0,
    )
    print(f"HTTP {r.status_code}")
    try:
        print(json.dumps(r.json(), indent=2))
    except ValueError:
        print(r.text)
    return 0 if r.status_code == 202 else 1


if __name__ == "__main__":
    raise SystemExit(main())
