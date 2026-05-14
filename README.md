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
| Supabase backend (orders + appointments) | `app/supabase_client.py`, `app/tools/backends_supabase.py` |
| SQL schema and dev seed | `migrations/` |
| Outbound calling endpoint + async Vapi client | `app/outbound.py`, `app/vapi_client.py` |
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
| `VAPI_API_KEY` | Used by the provisioning CLI **and** by `/outbound/call`. Never read by the inbound webhook. |
| `VAPI_PHONE_NUMBER_ID` | Phone number used for outbound dials and for `--attach-phone`. |
| `VAPI_ASSISTANT_ID` | Assistant to use for outbound dials. Set after running the provisioning CLI. |
| `OUTBOUND_API_KEY` | Bearer credential clients of *your* server present to trigger an outbound dial. Distinct from `VAPI_SERVER_SECRET`. |
| `OUTBOUND_RATE_LIMIT` | slowapi limit on `/outbound/call`, default `30/minute` per source IP. |
| `WEBHOOK_RATE_LIMIT` | slowapi limit string, default `120/minute` per source IP. |
| `EXTERNAL_CALL_TIMEOUT_S` | Per-call timeout on backend I/O (default 5.0s). |
| `LOG_LEVEL` | `INFO` by default. JSON logs to stdout. |
| `SUPABASE_URL` | Your Supabase project URL (e.g. `https://abc.supabase.co`). Leave blank to use the in-memory fakes. |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-side **service-role** key. Bypasses RLS; never expose it to a browser. |

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

## Supabase backend

Set `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` and the registry
automatically uses Supabase instead of the in-memory fakes — no code
changes. Selection happens in `build_registry_from_settings`
(`app/tools/registry.py`).

### Schema

Apply the migrations once per project:

```bash
# Either paste these into the Supabase SQL editor:
cat migrations/0001_schema.sql
cat migrations/0002_seed_dev.sql   # dev/staging only

# Or, with the Supabase CLI:
supabase db push
```

Two tables:

| Table | Purpose | Notes |
|---|---|---|
| `orders` | Order status read-model | `order_id` is the primary key. `items text[]`, `eta date NULL`. |
| `appointments` | Booked slots | Two UNIQUE indexes carry the production invariants — see below. |

### Invariants enforced by Postgres

- **`appointments.idempotency_key` UNIQUE.** The handler derives the
  key from `(call_id, date, time, name, contact)`. A retried tool call
  inserts a duplicate-key row; the backend catches the 23505,
  re-SELECTs by the key, and returns the original confirmation. The
  caller never gets two bookings.
- **`appointments.starts_at` UNIQUE.** Two concurrent callers asking
  for the same slot can both pass the pre-flight SELECT. The second
  INSERT hits the unique index and the backend maps the 23505 to
  `slot_taken`, which the handler speaks as "that slot was just
  taken — want a different time?"

Both paths are covered by `tests/test_supabase_backends.py` with an
httpx `MockTransport` standing in for PostgREST.

### Why hand-rolled PostgREST?

The Supabase Python client is sync; the rest of the service is async.
We only need three operations (select, select-by-key, insert), so
`app/supabase_client.py` is a thin async wrapper over httpx — no extra
dependency, full async, easy to mock.

The client uses the **service-role key** and bypasses RLS. Keep it on
the server only.

## Outbound calling

`POST /outbound/call` places an outbound phone call via the Vapi REST
API. Required env vars: `VAPI_API_KEY` (the same key used by the
provisioning CLI), `VAPI_ASSISTANT_ID`, `VAPI_PHONE_NUMBER_ID`, and
`OUTBOUND_API_KEY` (the bearer credential clients of *your* server
must present — deliberately distinct from the inbound webhook secret).

Trigger a dial:

```bash
curl -X POST http://localhost:8000/outbound/call \
  -H "Authorization: Bearer $OUTBOUND_API_KEY" \
  -H 'content-type: application/json' \
  -d '{
    "to": "+14155550100",
    "customer_name": "Jane Doe",
    "first_message": "Hi {{customer_name}}, calling about your order {{order_id}}.",
    "variables": {"customer_name": "Jane Doe", "order_id": "ORD-1001"},
    "reason": "order_followup",
    "idempotency_key": "followup-ORD-1001"
  }'
# -> 202 {"vapi_call_id":"…","status":"queued","outbound_call_id":"…"}
```

Or via the helper script:

```bash
python scripts/trigger_outbound.py \
  --to +14155550100 \
  --first-message 'Hi {{customer_name}}, calling about {{order_id}}.' \
  --var customer_name='Jane Doe' \
  --var order_id=ORD-1001 \
  --reason order_followup \
  --idempotency-key followup-ORD-1001
```

Pass `--dry-run` to print the request body without sending.

### Templating

`first_message` and the assistant's system prompt both support
`{{variable}}` substitution. Anything in the `variables` map on the
request is exposed to both. Use it to inject per-call context — order
ID, customer name, appointment time — so the assistant knows why
it's calling without having to ask.

Variables must be scalars (string/number/bool). Nested objects are
rejected at validation time.

### Idempotency

If you supply `idempotency_key` AND Supabase is configured:

1. The endpoint first SELECTs the `outbound_calls` row by that key.
   If it exists and has a `vapi_call_id`, the response is
   `status: "duplicate"` with the original call's IDs — **no second
   dial happens.**
2. Otherwise the call is placed, then the row is INSERTed. The
   `outbound_calls.idempotency_key` UNIQUE index guarantees only one
   row survives even under true concurrency.

Without Supabase the endpoint still works, but idempotency is
unenforceable and a duplicate request will dial twice. For production
outbound, enable Supabase.

### Errors

- `401` — bearer credential missing or wrong.
- `400` — phone number not E.164, variables nested, or assistant /
  phone-number IDs not configured.
- `400` from upstream Vapi (e.g. number not allowed) is forwarded as
  `400` with the Vapi message.
- `502` — Vapi returned 5xx (we don't auto-retry, to avoid
  double-dialing).
- `503` — `OUTBOUND_API_KEY` empty (refuses to operate) or
  `VAPI_API_KEY` not set.

## Swapping in other backends

`app/tools/backends.py` defines two `Protocol`s — `OrderBackend` and
`CalendarBackend`. The in-memory and Supabase backends both satisfy
them. To wire up something else (Cal.com, Google Calendar, an internal
ERP):

1. Implement the two protocols against your system.
2. Extend `build_registry_from_settings` to pick your backend by env
   var, or replace it entirely.

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
