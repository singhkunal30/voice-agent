# Voice Agent Architecture Simulator & Learning Lab

A flight simulator for voice/AI systems architecture.

You do not read diagrams here — you run simulated calls, break them, watch the
consequences propagate, change the requirements, and redesign. Every number is
produced by a deterministic simulation engine and labelled as the modelling
assumption it is.

It teaches one mental model end to end:

```
Requirements → Constraints → Architecture → Technology choices → Data/Audio flow
   → Latency → Infrastructure → Failure modes → Observability → Cost → Optimization
```

**No API keys. No external services. No network calls.** The entire simulation
engine runs in your browser.

---

## Run it

```bash
cd simulator
npm install
npm run dev          # http://localhost:5173
```

Production build, and served from the repo's FastAPI app at `/lab`:

```bash
npm run build
cd .. && uvicorn app.main:app   # http://localhost:8000/lab
```

Or the whole stack (API + Postgres + Redis + simulator):

```bash
docker compose up --build       # simulator at http://localhost:8000/lab
```

### Verify

```bash
npm run verify   # typecheck + lint + 194 unit/integration tests + production build
npm test         # tests only
npm run smoke    # optional: browser smoke test over all 26 routes (needs `npx playwright install`)
```

---

## Finding your way around

The sidebar groups the labs by the question they answer, and only the group you
are in stays open. Two shortcuts matter more than the menu:

- **⌘K** (or `/`) — search every lab and every glossary term. Plain words work:
  try "slow", "cost", "phone", "opus".
- **? How to use this** — on every lab. It opens by itself the first time you
  visit and lists three things to try, in order. After that it stays shut.

Prev/next links at the bottom of each lab walk the whole curriculum without the
menu. The **Detail** switch in the header (Plain / Engineering) decides whether
the advanced parameter panels start open. The ☾/☀ button toggles light and dark;
both themes are driven by the same CSS variables in `src/theme.css`, including
the hand-drawn SVG diagrams.

---

## What's inside

| Section | What you do there |
|---|---|
| **Home** | Three ways in, your progress, the full lab map |
| **Guided course** | 13 steps in 5 stages, from "what is a component" to "design under pressure" |
| **Scenarios** | 12 realistic briefs; activating one threads its requirements through every other lab |
| **Live call** | Run a full call: signalling → audio frames → VAD → STT → LLM → tools → TTS → playback. Interrupt it. Break it. |
| **Architecture canvas** | Drag, connect, configure, validate, simulate, export (JSON/PNG/SVG) |
| **Reference patterns** | 10 reference architectures, all editable |
| **Observability** | Simulated production console: spike → CPU → autoscale → queue → recovery |
| **Audio formats** | PCM, μ-law, Opus, sample rates, and detection of transcoding you didn't need |
| **Latency** | Closed-form waterfall; every input is a slider; streaming vs batch quantified |
| **Turn-taking** | Tune VAD against scripted audio containing a cough and a mid-sentence thinking pause |
| **Speech to text / Text to speech** | Simulated provider families; streaming vs batch; what noise and 8 kHz do to accuracy |
| **Agent runtime** | Context building, function calls, blocking vs async tools, failure recovery |
| **Conversation state** | Conversation / telephony / handoff machines — clickable, with timers and failure branches |
| **Telephony** | SIP ladder, RTP, DTMF, trunking — why signalling and media take different paths |
| **WebSockets** | Backpressure: watch an unbounded buffer convert a 3 s stall into permanent latency |
| **WebRTC** | SDP, ICE, STUN/TURN, and the browser-vs-phone architecture comparison |
| **Human handoff** | Availability check, queue, warm transfer, context transfer — and every failure branch |
| **Scaling** | Sizing, long-lived connections, autoscaling with warmup lag, multi-region failover |
| **Break things** | Arm failures, watch blast radius on the canvas, toggle mitigations, compare |
| **Reliability patterns** | Retry, backoff, jitter, circuit breaker, fallback — measured against one outage |
| **Cost** | Per-call/day/month/year, editable pricing sheet, optimisation levers |
| **Decision engine** | Requirements in → architecture out, with every Requirement→Constraint→Decision→Tradeoff record |
| **Compare designs** | Batch vs streaming vs speech-to-speech vs hybrid, on explicit axes |
| **Challenges** | Generated brief, your design, an honest evaluation (nothing revealed before you submit) |
| **Glossary** | Concept cards, each answering the same eight questions |

---

## Project structure

```
simulator/
├── src/
│   ├── domain/          Types, architecture builder DSL, learning progression
│   │   ├── types.ts     THE domain model — every lab reads these types
│   │   ├── builder.ts   Programmatic architecture construction
│   │   └── learning.ts  13-level progression
│   ├── engine/          The deterministic simulation kernel
│   │   ├── rng.ts       Seeded PRNG (SplitMix32) — no Math.random anywhere
│   │   ├── queue.ts     Binary min-heap, (time, seq) total ordering
│   │   ├── simulation.ts Virtual clock + event loop
│   │   └── callSim.ts   A complete voice call as a discrete-event simulation
│   ├── models/          Analytic models
│   │   ├── audio.ts     Formats, conversions, pipeline analysis
│   │   ├── latency.ts   Closed-form latency with overlap semantics
│   │   ├── scaling.ts   Resources, bottlenecks, sizing, traffic, regions
│   │   ├── cost.ts      Cost engine + optimisation levers
│   │   ├── reliability.ts Retry/backoff/breaker/fallback simulation
│   │   ├── vad.ts       VAD + turn detection over a scripted track
│   │   └── stateMachines.ts Conversation / telephony / handoff machines
│   ├── providers/       STT/TTS/LLM/Telephony interfaces + simulated impls
│   ├── registry/        Component catalog (the single source of component truth)
│   ├── validation/      Architecture rules
│   ├── decision/        Decision engine + architecture comparison
│   ├── scenarios/       12 scenario briefs
│   ├── patterns/        10 reference architectures
│   ├── challenges/      Generator + evaluator
│   ├── knowledge/       Concept cards
│   ├── state/           Zustand store (localStorage persistence)
│   ├── ui/              Shared components (canvas, timeline, waterfall, controls, ⌘K palette)
│   ├── labs/            One file per section
│   ├── nav.ts           Single source of truth for navigation, search and prev/next
│   └── theme.css        Colour tokens for both themes (Tailwind and the SVGs read the same vars)
└── scripts/smoke.mjs    Optional browser smoke test
```

---

## The simulation engine

Everything rests on determinism: **the same inputs and seed always produce the
same run.** That is what makes the numbers arguable rather than decorative.

- `Rng` — SplitMix32, seeded from a string. `Math.random()` appears nowhere in
  the engine. `rng.fork(label)` gives a subsystem its own stream so adding a
  draw in one place does not shift every other subsystem's numbers.
- `EventQueue` — binary min-heap ordered by `(time, insertionSeq)`. The sequence
  tiebreak makes the ordering *total*, so a run is reproducible down to the
  event index.
- `Simulation` — a virtual clock plus that queue. Running means: pop the
  earliest action, advance the clock to it, execute it. Actions emit events and
  schedule more actions.

The UI **animates** the resulting event log against a scaled wall clock. Pause,
step and speed change what you are looking at, never what happened. There is no
`setTimeout` chain driving any result.

```ts
const sim = new Simulation('my-seed')
sim.schedule(100, () => sim.emit({ type: 'SPEECH_STARTED', component: 'VAD', summary: '…' }))
const events = sim.run()          // totally ordered, deterministic
```

Barge-in is why `cancelTag` exists: queued TTS chunk deliveries are tagged, and
an interruption drops them from the queue rather than playing them out.

---

## How to extend it

### Add a component

1. Append a `ComponentSpec` to `src/registry/components.ts`. The type forces you
   to supply what the inspector shows: description, the problem it solves, I/O,
   protocols, latency model, resources, scaling model, failure modes,
   alternatives, why an architect chooses it, what happens when it fails, and
   all six learning levels.
2. Optionally add `config` fields — they appear automatically as live controls
   in the inspector and feed the simulation.
3. It is now available in the canvas palette, the validator, the scaling model
   and the cost engine. No other file needs to change.

Tests enforce completeness: every spec must have non-trivial text at all six
learning levels, every failure mode must state caller impact, signal and
mitigations, and every `concepts` reference must resolve to a knowledge card.

### Add a provider

Implement the interface in `src/providers/types.ts` (`SttProvider`,
`TtsProvider`, `LlmProvider`, `TelephonyProvider`, `S2sProvider`) and add it to
the relevant array in `src/providers/simulated.ts`. Providers are pure
functions of `(request, rng)`, so they stay deterministic.

These interfaces are the seam where a *real* provider would plug in: swap
`transcribe`/`synthesize`/`complete`/`placeCall` for network calls and nothing
above the provider layer changes.

### Add a scenario

Append a `Scenario` to `src/scenarios/library.ts` with its requirements, its
crux, a sample utterance and a `referencePatternId`. A test asserts the
reference pattern exists and that the scenario is runnable, priceable and
sizable.

### Add a failure mode

Add a `FailureMode` to the relevant component spec (it appears in the inspector
and Chaos Lab immediately). To make it injectable into calls, add a variant to
`FailureTarget` in `src/engine/callSim.ts`, handle it in `simulateCall`, and
list it in the Chaos Lab's `FAILURES` array.

### Extend the cost model

`src/models/cost.ts` holds `PricingSheet` (every field editable in the UI) and
`computeCost`. Add a line item by pushing to `items` with its basis string —
the basis is displayed, so it must explain how the number was derived. Add
what-if levers in `costLevers`.

### Add a validation rule

Write a `Rule` in `src/validation/rules.ts` and add it to `ALL_RULES`. A rule
must return findings that say what was **detected**, **why** it matters in a
voice system specifically, the **fix**, and the engineering **principle** behind
it — a test enforces that all four are present and substantive.

---

## Testing

194 tests across five suites:

| Suite | Covers |
|---|---|
| `engine/engine.test.ts` | PRNG determinism/distributions, heap ordering, virtual clock, event ordering, cancellation, step limits |
| `engine/callSim.test.ts` | Call event backbone, determinism, causal marker ordering, interruption, provider failures, handoff |
| `models/models.test.ts` | Audio arithmetic & pipeline grading, latency overlap semantics, cost shapes, scaling tiers, bottlenecks, autoscaling, regions, reliability strategies, VAD problems, state-machine reachability |
| `validation/validation.test.ts` | Registry/knowledge completeness, every validator rule, pattern integrity, decision-engine behaviour, challenge generation & evaluation |
| `integration.test.ts` | The twelve end-to-end scenarios (A–L), cross-cutting coherence, whole-app determinism |

The tests are not decoration — writing them surfaced eight real defects,
including a cost total that disagreed with the sum of its line items, an
endpointer that could only ever commit one turn, a human tier staffed at 100%
occupancy (which queueing theory says is never a plan), and generated
architectures that were saturated the moment they were produced.

---

## On the numbers

Every figure in this application is a **simulation assumption**: chosen to be
order-of-magnitude plausible and to make the *relationships* between design
choices visible. They are labelled as such in the UI, and the ones that matter
are editable.

They are not measurements of any vendor's production system, and the simulator
does not claim to know how any real provider behaves. Provider profiles
("premium streaming TTS", "self-hosted batch STT") model *classes* of choice,
not products. Compliance content is educational architecture consideration, not
legal advice.

What transfers to real work is the reasoning: which constraint forced which
decision, and what it cost you.
