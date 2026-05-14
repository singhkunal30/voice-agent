# Vapi Voice Agent

A production-grade inbound voice agent built on [Vapi](https://vapi.ai)
(telephony, STT, LLM, and TTS). Two capabilities:

- **`lookup_order`** — look up an order's status, ETA, and items by ID.
- **`book_appointment`** — book a 30-minute weekday slot, idempotent
  against webhook retries.

Vapi handles the phone call, transcription, LLM reasoning, and voice
synthesis. This service is the **tool webhook**: it receives `tool-calls`
events from Vapi, validates them, runs the business logic, and returns a
short, speakable result.

## Architecture

```
caller ──► Vapi (PSTN + STT + LLM + TTS) ──► POST /vapi/webhook ──► this service
                                                                       │
                                                                       ├── lookup_order  ──► OrderBackend  (fake / DB)
                                                                       └── book_appointment ──► CalendarBackend (fake / cal)
```

| Concern | Where it lives |
|---|---|
| Config (env-driven, pydantic-settings) | `app/config.py` |
| Webhook auth (bearer + X-Vapi-Secret + optional HMAC SHA256) | `app/security.py` |
| Webhook route, rate limiting, payload parsing | `app/webhook.py`, `app/main.py`, `app/ratelimit.py` |
| Pydantic schemas (webhook envelope + tool args) | `app/schemas/` |
| Tool dispatch + backend interfaces | `app/tools/registry.py`, `app/tools/backends.py` |
| Tool handlers (the spoken behavior) | `app/tools/handlers.py` |
| Assistant provisioning (Vapi REST API) | `app/assistant.py` |
| Versioned system prompt | `prompts/system_prompt_v1.md` |
| Structured JSON logging w/ call-id correlation | `app/logging_setup.py` |
| Tests (handlers, webhook, signatures, fixtures) | `tests/` |
| Local simulator | `scripts/simulate_webhook.py` |
| Container image | `Dockerfile` |

### Vapi docs consulted (May 2026)

- [Custom tools — request/response shape](https://docs.vapi.ai/tools/custom-tools)
  — `message.type = "tool-calls"`, `toolCallList[]`, response is
  `{"results":[{"toolCallId","result"|"error"}]}`. Vapi expects HTTP 200
  even for tool-level errors.
- [Server URL events](https://docs.vapi.ai/server-url/events) — list of
  server message types (we only act on `tool-calls`).
- [Server authentication](https://docs.vapi.ai/server-url/server-authentication)
  — bearer / X-Vapi-Secret / HMAC SHA256 modes.
- [Create assistant API](https://docs.vapi.ai/api-reference/assistants/create)
  — `POST /assistant` shape used by `app/assistant.py`.

The webhook accepts **two** payload shapes — the current
`toolCallList: [{id, name, arguments}]` form and the legacy
OpenAI-style `toolCalls: [{id, type, function: {name, arguments}}]` form
— because Vapi has shipped both. See `app/schemas/webhook.py`.

## Quickstart (local)

```bash
git clone <this repo>
cd voice-agent
python3.11 -m venv .venv
.venv/bin/pip install -r requirements.txt
cp .env.example .env  # then edit secrets

# Run the server
.venv/bin/uvicorn app.main:app --reload
```

Smoke test the webhook locally:

```bash
# In another terminal:
VAPI_SERVER_SECRET=replace-with-a-long-random-string \
  .venv/bin/python scripts/simulate_webhook.py --tool lookup_order
```

You should see an HTTP 200 with a `results[].result` like
`"Order ORD-1001 is shipped..."`.

## Exposing the webhook via ngrok

Vapi needs a public HTTPS URL. The simplest path is
[ngrok](https://ngrok.com):

```bash
ngrok http 8000
# → https://abcdef.ngrok.app  (use this as your server URL)
```

## Provisioning the assistant

Set `VAPI_API_KEY` (your **private** API key from the Vapi dashboard) and
`VAPI_SERVER_SECRET` in `.env`, then:

```bash
.venv/bin/python -m app.assistant \
  --server-url https://abcdef.ngrok.app/vapi/webhook
# → Created assistant <id>
# → {"assistant_id": "<id>"}
```

To attach a phone number you've already purchased in the Vapi dashboard:

```bash
export VAPI_PHONE_NUMBER_ID=phn_xxx
.venv/bin/python -m app.assistant \
  --server-url https://abcdef.ngrok.app/vapi/webhook \
  --attach-phone
```

To update an existing assistant (e.g. after editing the prompt):

```bash
.venv/bin/python -m app.assistant \
  --server-url https://abcdef.ngrok.app/vapi/webhook \
  --assistant-id <id>
```

## Environment variables

See `.env.example`. The important ones:

| Var | Purpose |
|---|---|
| `VAPI_SERVER_SECRET` | Shared secret Vapi sends back. Compared in constant time against `Authorization: Bearer …` and legacy `X-Vapi-Secret`. **Required.** |
| `VAPI_HMAC_ENABLED` | If `true`, the webhook also accepts requests signed with HMAC SHA256. |
| `VAPI_HMAC_SECRET` / `VAPI_HMAC_HEADER` | HMAC key and signature header name (default `x-vapi-signature`). |
| `VAPI_API_KEY` | Used only by the provisioning script. Never read by the webhook. |
| `VAPI_PHONE_NUMBER_ID` | Optional; used with `--attach-phone`. |
| `WEBHOOK_RATE_LIMIT` | slowapi limit string, default `120/minute` per source IP. |
| `EXTERNAL_CALL_TIMEOUT_S` | Per-call timeout on backend I/O (default 5.0s). |
| `LOG_LEVEL` | `INFO` by default. JSON logs to stdout. |

## Tests

```bash
.venv/bin/python -m pytest -q
```

The suite covers:

- Tool handlers: success, not-found, invalid args, weekend/off-hours
  slots, slot collision across calls, **idempotency** within a call
  (replay of the same args + call-id returns the same booking).
- Webhook: auth (missing, wrong secret, X-Vapi-Secret, bearer, HMAC
  good and bad), the current `toolCallList` shape, the legacy
  `toolCalls`/`function` shape, unknown tool returns `error` (not 500),
  non–`tool-calls` events return `{"results":[]}`, malformed JSON and
  schema mismatches return 400, health and readiness endpoints.
- Fixtures use real Vapi payload shapes from the docs.

## Production notes

- **HTTP 200 on tool errors.** Vapi ignores non-200 responses entirely.
  Tool failures are returned as `{"toolCallId": "…", "error": "…"}`; the
  string is spoken back to the caller verbatim, so error messages in
  `handlers.py` are phrased for voice.
- **Idempotency.** `book_appointment` derives a SHA-256 key from
  `(call_id, date, time, name, contact)`. A retried webhook within the
  same call returns the original confirmation; a brand-new call asking
  for the same slot gets `slot_taken`.
- **Timeouts.** Every backend call is wrapped in `asyncio.wait_for` with
  `EXTERNAL_CALL_TIMEOUT_S`. Timeouts become a friendly spoken error,
  never a 500.
- **Rate limiting.** `slowapi` per source IP on `/vapi/webhook` only;
  health endpoints are uncapped so load balancers don't trip it.
- **Auth.** Constant-time compare on every credential path. HMAC mode
  validates over the **raw** request bytes (FastAPI dependency returns
  the body to avoid re-reads).
- **Logging.** JSON to stdout with a `call_id` field set from the Vapi
  call ID on every line of a request — works with Datadog, Loki,
  Cloud Logging, etc. without a parser.
- **Graceful shutdown.** Uvicorn drains in-flight requests on SIGTERM;
  there's no background state to flush. If you swap the in-memory
  backends for real ones, close their pools in the `lifespan` block.

## Swapping in real backends

`app/tools/backends.py` defines two `Protocol`s — `OrderBackend` and
`CalendarBackend` — and ships in-memory implementations so the project
runs end-to-end without credentials. To plug in production systems:

1. Implement the two protocols against your DB / ERP / calendar.
2. Build a different registry in `app/tools/__init__.py` (or replace
   `build_default_registry` in `app/main.py`).

Tests run against the protocols, so they keep working unchanged.

## Deployment

The Dockerfile produces a slim, non-root image with a built-in
`/healthz` healthcheck. A typical deployment:

```bash
docker build -t voice-agent .
docker run -p 8000:8000 --env-file .env voice-agent
```

Behind a load balancer, point `/healthz` at the liveness probe and
`/readyz` at the readiness probe. Set `--proxy-headers` (already in the
default `CMD`) so source-IP rate limiting works.
