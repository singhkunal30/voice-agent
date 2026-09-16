# Voice Agent

A production-grade inbound + outbound voice agent built from
self-hostable parts:

- **Twilio** — PSTN, phone numbers, audio transport (Media Streams over WSS).
- **Pipecat** — real-time pipeline orchestration, VAD, turn-taking.
- **Deepgram** — streaming speech-to-text.
- **OpenAI GPT-4o-mini** — conversation + tool calling.
- **ElevenLabs** — streaming text-to-speech.
- **Supabase (optional)** — Postgres for orders, appointments, outbound audit.
- **FastAPI** — webhook server, outbound REST, health/readiness.

Two capabilities the agent handles:

- `lookup_order(order_id)` — status, ETA, items.
- `book_appointment(date, time, customer_name, contact)` — 30-min
  weekday slots, idempotent against retries.

## Two things live in this repository

| | What it is | Where |
|---|---|---|
| **Voice Agent** | A real, deployable streaming voice agent. Answers phone calls, transcribes, reasons, calls tools, speaks back. | `app/` |
| **Voice Agent Lab** | A workspace for voice-agent architecture: draw a system, predict what it will do, run it, break it, and redesign. Pressure tests, agent-quality simulation, a deterministic evaluation suite. No API keys, no external services. | `simulator/` |

They are complementary: the simulator's `media-gateway` and `agent-runtime`
components model the exact process `app/` implements, and its "Simple customer
support agent" scenario is this codebase's brief. Build the simulator and the
FastAPI app serves it at **`/lab`**.

```bash
cd simulator && npm install && npm run build
cd .. && uvicorn app.main:app     # → http://localhost:8000/lab
```

See [`simulator/README.md`](simulator/README.md) for the full tour and
[`simulator/ARCHITECTURE.md`](simulator/ARCHITECTURE.md) for how it is built.

## Architecture

```
caller ──► Twilio (PSTN) ──► POST /twilio/voice ──► TwiML <Connect><Stream/>
                                                        │
                                                        ▼
                                              WSS /twilio/media
                                                        │
                                                        ▼
                              Pipecat: VAD → Deepgram → GPT-4o-mini → ElevenLabs
                                                        │
                                                        ├─► lookup_order  ──► OrderBackend
                                                        └─► book_appointment ──► CalendarBackend

internal caller ──► POST /outbound/call ──► Twilio REST /Calls ──► (callee picks up) ──► same flow
```

| Concern | Where it lives |
|---|---|
| Config (env-driven, pydantic-settings) | `app/config.py` |
| Inbound Twilio webhook + Media Stream WS | `app/transport/twilio_inbound.py` |
| Twilio signature verification | `app/transport/twilio_signature.py` |
| Outbound Twilio REST client | `app/transport/twilio_outbound.py` |
| Outbound endpoint (auth, idempotency, audit) | `app/outbound.py`, `app/schemas/outbound.py` |
| Pipecat pipeline factory | `app/agent/pipeline.py` |
| System prompt loader | `app/agent/prompts.py`, `prompts/system_prompt_v1.md` |
| Pipecat ⇄ ToolRegistry adapter | `app/agent/tools_bridge.py` |
| Tool dispatch + backend Protocols | `app/tools/registry.py`, `app/tools/backends.py` |
| Tool handlers (the spoken behavior) | `app/tools/handlers.py` |
| Supabase backends + PostgREST client | `app/supabase_client.py`, `app/tools/backends_supabase.py` |
| SQL schema | `migrations/` |
| Structured JSON logging w/ call-id | `app/logging_setup.py` |
| Tests | `tests/` |
| Local simulators | `scripts/` |

## Quickstart (local)

```bash
git clone <this repo>
cd voice-agent
python3.11 -m venv .venv
.venv/bin/pip install -r requirements.txt
cp .env.example .env  # then fill in secrets

# Run the server
.venv/bin/uvicorn app.main:app --reload
```

For real phone calls you need a public HTTPS URL. The simplest path:

```bash
ngrok http 8000
# -> https://abcd.ngrok.app  -- set this as PUBLIC_BASE_URL in .env
```

Then in the [Twilio console](https://console.twilio.com), edit the
voice configuration for your number:

- **A call comes in** → Webhook → `https://abcd.ngrok.app/twilio/voice` (HTTP POST).

When you call the number you should hear "Hi, thanks for calling Acme…"

## Environment variables

See `.env.example`. The important ones:

| Var | Purpose |
|---|---|
| `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` | Twilio credentials. The auth token is used both to sign outbound REST and to verify `X-Twilio-Signature` on inbound webhooks. |
| `TWILIO_FROM_NUMBER` | Twilio number that places outbound calls (E.164). |
| `PUBLIC_BASE_URL` | HTTPS URL Twilio uses to reach us — for the voice webhook and to build the `wss://` URL for Media Streams. |
| `DEEPGRAM_API_KEY` | Streaming STT. |
| `ELEVENLABS_API_KEY` / `ELEVENLABS_VOICE_ID` / `ELEVENLABS_MODEL` | Streaming TTS. |
| `OPENAI_API_KEY` / `OPENAI_MODEL` | LLM (default `gpt-4o-mini`). |
| `OUTBOUND_API_KEY` | Bearer credential required to trigger `/outbound/call`. Distinct from `TWILIO_AUTH_TOKEN`. |
| `OUTBOUND_RATE_LIMIT` / `WEBHOOK_RATE_LIMIT` | slowapi strings, default `30/minute` and `120/minute` per source IP. |
| `EXTERNAL_CALL_TIMEOUT_S` | Per-call timeout on backend I/O (default 5.0s). |
| `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` | Optional. When both set, orders + appointments live in Postgres. |
| `LOG_LEVEL` | `INFO` by default. JSON logs to stdout. |

## Outbound calling

`POST /outbound/call` places an outbound phone call via the Twilio
REST API.

```bash
curl -X POST http://localhost:8000/outbound/call \
  -H "Authorization: Bearer $OUTBOUND_API_KEY" \
  -H 'content-type: application/json' \
  -d '{
    "to": "+14155550100",
    "customer_name": "Jane Doe",
    "first_message": "Hi {{customer_name}}, calling about order {{order_id}}.",
    "variables": {"customer_name": "Jane Doe", "order_id": "ORD-1001"},
    "reason": "order_followup",
    "idempotency_key": "followup-ORD-1001"
  }'
# -> 202 {"provider_call_id":"CA...", "status":"queued", "outbound_call_id":"..."}
```

Or via the helper:

```bash
python scripts/trigger_outbound.py \
  --to +14155550100 \
  --first-message 'Hi {{customer_name}}, calling about {{order_id}}.' \
  --var customer_name='Jane Doe' \
  --var order_id=ORD-1001 \
  --reason order_followup \
  --idempotency-key followup-ORD-1001
```

### How overrides reach the call

Twilio doesn't have a per-call "assistant overrides" concept. We pass
`first_message` and `variables` to Twilio's `Url=` parameter as query
params on the TwiML callback. When the callee picks up, Twilio fetches
that URL, we read the query params, and the pipeline starts with the
customised greeting.

### Idempotency

With Supabase configured and an `idempotency_key`:

1. SELECT by key. If a row exists with a `provider_call_id`, return
   `status: "duplicate"` and **no second dial happens.**
2. Otherwise call Twilio, then INSERT the audit row. The
   `outbound_calls.idempotency_key` partial UNIQUE index keeps things
   correct under concurrency.

Without Supabase, duplicate requests dial twice. For production
outbound, run with Supabase.

### Error mapping

- `401` — bearer missing/wrong.
- `400` — E.164 invalid, variables nested, etc.
- `400` from Twilio (e.g. number not allowed) is forwarded as `400`.
- `502` — Twilio returned 5xx (we don't auto-retry; that's how you
  double-dial).
- `503` — `OUTBOUND_API_KEY` empty, or Twilio not configured.

## Supabase

Optional. With `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` set, the
registry switches to Supabase-backed backends and the outbound
endpoint writes an audit row per dial. Apply the migrations once per
project:

```bash
# Either paste these into the Supabase SQL editor:
cat migrations/0001_schema.sql
cat migrations/0002_seed_dev.sql   # dev/staging only
cat migrations/0003_outbound_calls.sql

# Or with the Supabase CLI:
supabase db push
```

Three tables:

| Table | Purpose | Notes |
|---|---|---|
| `orders` | Order status read-model | `order_id` PK, `items text[]`, `eta date NULL`. |
| `appointments` | Booked slots | `UNIQUE(idempotency_key)` + `UNIQUE(starts_at)`. |
| `outbound_calls` | Outbound audit log | Partial `UNIQUE(idempotency_key) WHERE idempotency_key IS NOT NULL`. |

Constraint-driven invariants:

- **Appointments.** Idempotency-key UNIQUE — a retried tool call
  returns the original confirmation. Starts-at UNIQUE — two callers
  cannot grab the same slot.
- **Outbound calls.** Same key UNIQUE — a retried API request returns
  the original Twilio CallSid.

The Supabase client (`app/supabase_client.py`) is hand-rolled async
over httpx. The official `supabase-py` is sync; we keep the rest of
the service async by talking PostgREST directly with only three verbs
(select, select-by-key, insert).

## Tests

```bash
.venv/bin/python -m pytest -q
```

The suite covers, without ever touching Twilio, Deepgram, ElevenLabs,
OpenAI, or Supabase for real:

- **Tool handlers** — success, not-found, invalid args, weekday/off-hours,
  slot collision, in-call idempotency.
- **Supabase backends** — lookup, fresh booking, idempotency replay,
  concurrent idempotency race, slot collision via constraint name,
  off-hours short-circuit, registry-level lookup speakable.
- **Pipecat ⇄ ToolRegistry bridge** — schema content, all tools
  registered, success/error/invalid-args paths produce the right
  `{result|error}` payload.
- **Twilio inbound** — signature missing/wrong/correct, TwiML content,
  health/readiness probes.
- **Outbound endpoint** — auth, validation (E.164, no nested vars),
  override forwarding into the Twilio TwiML URL, 4xx pass-through,
  5xx → 502, idempotency replay, fresh-call audit insert.
- **Simulator UI mount** — `/lab` serves the built simulator, returns a
  helpful 503 when it is not built, and never shadows existing routes.

52 tests, ~3 seconds.

### Simulator tests

The simulator has its own suite (TypeScript, Vitest) covering the
simulation engine, all the analytic models, the validator, the decision
engine, the pressure/quality/evaluation models, the guided course and
twelve end-to-end scenarios:

```bash
cd simulator
npm run verify       # typecheck + lint + 331 tests + production build
npm run smoke        # every route renders, 19 interactions work (needs a preview server)
npm run coursecheck  # the course thread holds and progress cannot be faked
```

## Local simulators

```bash
# Inbound: posts a signed Twilio voice webhook against your running
# server; prints the TwiML response.
TWILIO_AUTH_TOKEN=... PUBLIC_BASE_URL=http://127.0.0.1:8000 \
    python scripts/simulate_inbound.py

# Outbound: triggers a dial via /outbound/call.
OUTBOUND_API_KEY=... python scripts/trigger_outbound.py \
    --to +14155550100 \
    --first-message 'Hi {{name}}' \
    --var name='Pat' \
    --dry-run
```

## Production notes

- **Latency.** Pipecat tuned defaults + Cartesia/ElevenLabs Turbo +
  Deepgram Nova give ~700-1100 ms turn latency on a warm pipeline.
  ElevenLabs Turbo TTS is the dominant component; switching to
  Cartesia would shave ~150-300 ms off TTS first-byte if you need
  lower latency.
- **Cost.** GPT-4o-mini at ~5-15 K tokens per call ≈ $0.01-0.03 per
  call. Deepgram + ElevenLabs at typical call lengths ≈ $0.03-0.10
  per minute. Twilio US local minutes ≈ $0.014/min.
- **HTTP 200 on tool errors.** The Pipecat bridge translates a
  `ToolError` into `{"error": "..."}` payload returned via
  `result_callback`. The LLM then speaks the friendly error to the
  caller; nothing surfaces as a transport failure.
- **Idempotency.** Booking and outbound both rely on Postgres UNIQUE
  indexes when Supabase is configured, so multi-replica deployments
  are safe.
- **Rate limiting.** slowapi per source IP — `120/min` on the Twilio
  webhook, `30/min` on outbound; health endpoints uncapped.
- **Auth.** Constant-time compare on every credential path. Twilio
  webhook signature uses the standard HMAC-SHA1 over canonical URL +
  sorted params.
- **Logging.** JSON to stdout with a `call_id` field set from the
  Twilio `CallSid` on every request line.
- **Graceful shutdown.** Uvicorn drains in-flight HTTP requests on
  SIGTERM. The lifespan exit closes the Supabase and Twilio httpx
  pools.

## Swapping backends

`app/tools/backends.py` defines two `Protocol`s — `OrderBackend` and
`CalendarBackend`. The in-memory and Supabase backends both satisfy
them. To plug in a different store (Cal.com, Google Calendar, an
internal ERP):

1. Implement the two Protocols against your system.
2. Extend `build_registry` in `app/tools/registry.py` to pick your
   backend by env var, or replace it entirely.

Tests run against the Protocols, so they keep working unchanged.

## Deployment

```bash
docker build -t voice-agent .
docker run -p 8000:8000 --env-file .env voice-agent
```

Or the whole local stack — API, Postgres, Redis, and the simulator at
`/lab`:

```bash
cd simulator && npm install && npm run build && cd ..
docker compose up --build            # http://localhost:8000/lab

docker compose --profile ui up       # + simulator dev server on :5173
```

Postgres and Redis are included because the simulator teaches the roles
they play (durable record / ephemeral session state) and the agent can
use them locally instead of Supabase. Neither is required by the
simulator itself, which runs entirely in the browser.

Behind a load balancer:

- `/healthz` → liveness.
- `/readyz` → readiness.
- WebSocket termination must support `wss://` and pass through
  upgrade headers — typical for ALB / nginx / Cloudflare with
  appropriate config.
- Set `PUBLIC_BASE_URL` to the externally-visible HTTPS host. Twilio
  rejects WS upgrades to bare-IP or non-TLS URLs in production.
