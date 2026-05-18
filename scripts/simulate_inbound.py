#!/usr/bin/env python3
"""Simulate a Twilio voice webhook against a running server.

Lets you verify the /twilio/voice handler returns valid TwiML, with
a correctly computed X-Twilio-Signature so the request passes the
signature check.

This does NOT exercise the WebSocket media stream — that needs a
real Twilio call.

Usage:
    TWILIO_AUTH_TOKEN=... PUBLIC_BASE_URL=https://... \
        python scripts/simulate_inbound.py [--url URL]
"""

from __future__ import annotations

import argparse
import os
import sys

import httpx
from twilio.request_validator import RequestValidator


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument(
        "--url",
        default=None,
        help=(
            "Full URL of /twilio/voice. Defaults to PUBLIC_BASE_URL "
            "joined with /twilio/voice."
        ),
    )
    args = p.parse_args()

    token = os.environ.get("TWILIO_AUTH_TOKEN", "")
    base = os.environ.get("PUBLIC_BASE_URL", "").rstrip("/")
    if not token or not base:
        print(
            "TWILIO_AUTH_TOKEN and PUBLIC_BASE_URL must be set.",
            file=sys.stderr,
        )
        return 2

    url = args.url or f"{base}/twilio/voice"

    params = {
        "CallSid": "CAtestcall000000000000000000000001",
        "AccountSid": "ACtest000000000000000000000000000",
        "From": "+14155550100",
        "To": "+15551230000",
        "Direction": "inbound",
    }
    sig = RequestValidator(token).compute_signature(url, params)
    r = httpx.post(
        url,
        data=params,
        headers={"X-Twilio-Signature": sig},
        timeout=10.0,
    )
    print(f"HTTP {r.status_code}")
    print(r.text)
    return 0 if r.status_code == 200 else 1


if __name__ == "__main__":
    raise SystemExit(main())
