# Implementation architecture

How the simulator is built, and why it is built this way. For *what it does*,
see [README.md](./README.md).

---

## 1. The central constraint: one domain model

The brief's most important structural requirement was that the sections must
not be "disconnected toys". That is enforced structurally rather than by
convention:

```
                     src/domain/types.ts
                              │
             ┌────────────────┼────────────────┐
             ▼                ▼                ▼
   registry/components   Architecture      Requirements
     (ComponentSpec)    (nodes + edges)   (the brief)
             │                │                │
   ┌─────────┴──────┬─────────┴───────┬────────┴────────┐
   ▼                ▼                 ▼                 ▼
engine/callSim  models/scaling   validation/rules  models/cost
   │                │                 │                 │
   └────────────────┴─────────────────┴─────────────────┘
                              │
                        labs/*.tsx  (pure views)
```

There is exactly one representation of a component (`ComponentSpec`), one of an
architecture (`Architecture`), and one of a brief (`Requirements`). A capacity
assumption edited in the Architecture Canvas immediately changes the Cost
Simulator's instance count, the Scaling Lab's bottleneck detection and the
Challenge evaluator's verdict, because all four read the same object.

The labs contain no domain logic. They are views over engines.

---

## 2. The simulation kernel

### Why discrete-event, not `setTimeout`

A chain of timers gives you an animation, not a model: you cannot step it,
cannot reproduce it, cannot compute anything from it, and its results depend on
the browser's scheduling. The brief explicitly ruled it out.

Instead: a virtual clock and a priority queue.

```
run():
  while queue is not empty:
      action ← pop earliest (time, seq)
      clock  ← action.time
      execute action        # may emit events, may schedule more actions
```

Three properties follow:

1. **Determinism.** Given `(inputs, seed)` the event log is byte-identical. The
   test suite asserts this at the whole-app level.
2. **Total ordering.** Ties in virtual time break by insertion sequence, so
   "what happened first" is never ambiguous — important when a transcript, a
   barge-in and a tool result land in the same millisecond.
3. **Separation of computation from presentation.** `run()` completes before
   anything is drawn. The UI replays the finished log.

### Randomness

`Rng` is SplitMix32 seeded from a string. `Math.random()` appears nowhere in the
engine — a lint-visible, test-enforced rule.

`rng.fork(label)` matters more than it looks: subsystems draw from independent
streams, so adding a jitter draw to the TTS model does not shift every
subsequent STT number and invalidate saved comparisons.

Distributions are chosen to match the phenomena: log-normal for service latency
(right-skewed, floored at zero), exponential for inter-arrival times, normal
(clamped to ±4σ) where symmetric spread is correct.

### Cancellation is a first-class operation

Barge-in is the reason `EventQueue.removeWhere` exists. Queued TTS chunk
deliveries carry a tag; an interruption removes them from the queue rather than
letting them play out. This models the real bug the lab teaches: cancelling
synthesis upstream while leaving already-buffered audio at the transport is why
agents "keep talking" after being interrupted.

---

## 3. Two kinds of model

The simulator deliberately uses two different techniques, because they answer
different questions.

**Discrete-event** (`engine/callSim.ts`) — for *one call*. Produces a causal
event log with jitter sampled from the seed. Answers "what happened, in what
order, and why did this call feel slow?"

**Closed-form analytic** (`models/latency.ts`) — for *the pipeline*. No
sampling: move a slider, the whole waterfall recomputes instantly. Answers
"which stage owns my latency budget, and what does changing it cost?"

They agree on structure and are cross-checked: an integration test asserts the
call simulation's perceived latency equals its own playback event minus its
speech-end marker, and that the latency segments sum to the total.

The analytic model encodes the insight that makes streaming pipelines
comprehensible:

```
perceived ≠ Σ(all stage durations)
perceived  = critical path through overlapping stages
```

Endpointing and STT finalization run **in parallel**; the later one gates the
turn. Streaming stages overlap; batch stages serialise. The model computes both
worlds from identical inputs so the difference is visible rather than asserted.

**Tick-based fleet simulation** (`models/scaling.ts`) is the third technique,
used where the question is aggregate behaviour over time: offered load,
autoscaling with warmup lag, queue growth at saturation, M/M/c-flavoured
queueing latency, and recovery.

---

## 4. Provider abstraction

```ts
interface SttProvider  { transcribe(req, rng): SttResult }
interface TtsProvider  { synthesize(req, rng): TtsResult }
interface LlmProvider  { complete(req, rng): LlmResult }
interface TelephonyProvider { placeCall(req, rng): CallResult }
```

Nothing above this layer knows a concrete vendor. Two payoffs:

- The simulator needs no keys and no network — every provider is a deterministic
  model driven by the run's seed.
- Swapping in a real provider means implementing the same method with a network
  call. The seam already exists.

Providers model *classes* of choice (managed streaming STT, self-hosted batch
STT, premium streaming TTS, file-oriented TTS) rather than products, because the
architectural lesson is in the class, not the brand.

STT errors are generated by a word-corruption model with a domain confusion
table, so a simulated 8% WER shows up as `"premium four a one crore"` — a
mishearing that looks like a mishearing, not random noise.

---

## 5. The architecture graph

```ts
ArchNode  { id, specId, label, position, config, replicas, region }
ArchEdge  { id, source, target, type, protocol, direction, streaming, latencyMs, plane }
```

Two fields carry most of the teaching weight:

- **`plane`** — `media` or `control`. The media/control split is modelled in the
  type system, coloured on the canvas, and enforced by validation rules. A
  database reachable over a media-plane edge is an *error*, not a style note.
- **`type`** — `sync` / `streaming` / `async` / `persistent` / `control`. This
  is what lets the validator distinguish "slow dependency on the control plane"
  (fine) from "blocking call inside the audio loop" (not fine).

`ArchBuilder` is a small DSL for constructing graphs programmatically, used by
the pattern library, the decision engine and the tests, so no architecture is
defined by hand-written coordinates.

---

## 6. Validation

17 rules in `validation/rules.ts`. Every finding must supply four things:

```ts
{ detected, why, fix, principle }
```

`detected` is what the analysis observed, `why` explains the consequence **in a
voice system specifically**, `fix` is actionable, `principle` names the
engineering rule. A test asserts all four are present and substantive on every
rule — that is what keeps the validator from degenerating into a linter.

Rules encode the brief's realistic engineering principles: real-time media must
not wait on slow storage, persistent connections require connection-aware
scaling, external providers need fallbacks or accepted written-down risk, every
external dependency needs a timeout that fits the conversational budget, state
needs explicit ownership, handoff is a state transition with failure branches.

The validator never throws. A rule that crashes is swallowed, because a broken
rule must not take down the user's ability to check their design.

---

## 7. The decision engine

`decision/engine.ts` turns `Requirements` into an `Architecture` — but the
architecture is the by-product. The deliverable is the chain:

```ts
DecisionRecord {
  requirement    // what the brief demanded
  constraint     // the physics/economics that follow
  decision       // what was chosen
  tradeoff       // what it costs you
  alternatives   // what was rejected, and why
  confidence     // high | medium | contextual
}
```

Generated architectures are validated by the same rules a user's design is, and
a test asserts they produce **zero errors at their own design point** across four
orders of magnitude of concurrency. That test caught real sizing bugs: tiers
left at one replica, and provider "quota units" saturated the moment they were
generated.

Sizing is capacity arithmetic with explicit headroom, not magic numbers:

```
instances = ceil(concurrent / capacityPerInstance / 0.7)
```

Human staffing is deliberately different — seats are sized for ~75% target
occupancy, because Erlang C says queue waits explode near saturation. Staffing
to 100% is never a plan, and the model refuses to pretend otherwise.

---

## 8. Resource model & the capacity-unit problem

`computeResources` maps offered concurrent calls onto per-node capacity. One
subtlety worth recording: **not every component's capacity is denominated in
calls**. A Kubernetes cluster's capacity is pods; an observability stack's is
events per second. Dividing concurrent calls by those produces a meaningless
"utilisation", so they are excluded from call-based analysis rather than given a
fictional share of the load. `loadShare` handles the components that *do* scale
with calls but see only a fraction of them (a database sees ~40% of turns; a
human tier sees ~10% of calls).

---

## 9. State & persistence

Zustand holds only cross-cutting state: the working architecture, active
scenario, view mode (Simple/Engineering), saved architectures and learning
progress. Everything lab-local (slider positions, playback cursors) stays in the
lab.

Persistence is `localStorage`, wrapped so a failure (private mode, full quota)
degrades to "no persistence" rather than a crash. There is no backend, by design.

---

## 10. Rendering

React 18 + Vite + TypeScript (strict) + Tailwind. React Flow for the canvas,
Recharts for time series.

Route-level code splitting keeps the initial bundle small; the two heavy
libraries are isolated into their own chunks so labs that do not use them never
pay for them.

**One rendering subtlety worth documenting**, because it cost real debugging
time: React Flow hides nodes until it has measured them. Memoising the node
array on the `highlights` *object identity* — which callers construct inline,
so it changes every render — rebuilt every node continuously, reset the
measurement pass, and left the canvas populated in the DOM but blank on screen.
The fix is content-based memo keys plus seeded `initialWidth`/`initialHeight`,
and a `ResizeObserver` that re-fits the view once the flex container has real
dimensions.

---

## 11. Integration with the voice agent

`app/simulator_ui.py` mounts the built simulator at `/lab` on the repository's
existing FastAPI voice agent. The mount is conditional: with no build present
the app starts exactly as before and `/lab` returns a 503 that tells you how to
build it. The voice agent's behaviour is unchanged either way, and the simulator
has no server-side component to break.

This is deliberate symmetry: the repository contains a *real* streaming voice
agent (Twilio Media Streams → Pipecat → Deepgram/OpenAI/ElevenLabs, with
idempotent tool calls), and the simulator's `media-gateway` and `agent-runtime`
components model that exact process. The labs teach the architecture that real
code lives inside.

---

## 12. The prediction gate

`src/ui/Prediction.tsx` is a view, but it carries a design rule that reaches
into the store and the course, so it belongs here.

A lab wraps its results in a `<PredictionGate>`. The gate renders the question,
hides the children, and only shows them once the learner has committed to an
option — or explicitly skipped, which is allowed and marked as producing
information rather than evidence.

Three properties make it worth the indirection:

1. **The gate never sees the model.** It takes `actual` as a plain option id the
   lab computed. No question needs to know how its answer is produced, and no
   model needs to know it is being predicted against.
2. **Ordering carries meaning.** Options are listed least-to-most, so the
   distance between prediction and measurement is interpretable: one band out is
   a wrong constant, several is a wrong causal model. That is what the gate
   reports instead of a score.
3. **A retry on the same arming is refused.** `recordedFor` holds
   `questionId:resetKey`; once a prediction has been recorded for that pair, a
   second commit is not. Naming a band after seeing it is not a prediction. Labs
   pass a `resetKey` that changes when the question genuinely changes — a new
   pressure test, a new load, a different pipeline shape.

A correct prediction writes `predicted:<questionId>` into the progress map via
`recordPrediction`. That flag is the evidence the course consumes, and it is the
only progress flag in the app that no lab can set directly.

---

## 13. Pressure testing re-uses the models, it does not replace them

`models/pressure.ts` is deliberately thin on arithmetic. Each of the ten tests
mutates requirements or reads the architecture graph, then calls the *existing*
`detectBottlenecks`, `computeLatency`, `computeCost` and `validateArchitecture`.
Nothing in it is a second opinion about capacity or latency; it is the same
models asked a harder question.

The one thing it adds is a vocabulary: `holds` / `degrades` / `breaks`, where
the distinction between the last two is whether you need a **bigger** system or
a **different** one. Adding replicas is a purchase order. Moving session state
out of process memory is a project. A verdict that blurs those two is not worth
reporting.

Per-component availability is the exception: it is a crude assumption table
keyed on scaling axis and replica count, documented as such in the file. What it
teaches is exact even where the constants are not — availability multiplies
along a serial critical path, so the weakest hop caps the system.

---

## 14. Quality is simulated per failure kind, never as one number

`models/agentQuality.ts` computes a separate probability for each of six failure
kinds and evaluates them in the order they would occur in a real turn, stopping
at the first that fires. That ordering matters: a turn whose transcript was
wrong is not *also* independently a tool-selection failure.

Two functions come out of it, and labs use both for different jobs:

- `runQuality(cfg)` — one seeded run. Twelve concrete turns a learner can read.
- `expectedFailureRate(cfg)` / `expectedByKind(cfg)` — the analytic expectation,
  no sampling. This is what comparisons are judged on, because comparing two
  configurations on one seed each compares the seeds.

`expectedByKind` sums exactly to `expectedFailureRate` — both are the same
telescoping product, and a test pins the identity.

`models/evaluation.ts` sits on top and adds severity, which is assigned by what
the *caller* can do about the failure rather than by how wrong the agent was.
That is why a hallucination is a FAIL and a misunderstanding is only a PARTIAL:
the misunderstanding is visible and self-correcting, and the hallucination is
neither.

---

## 15. Honesty about numbers

Every figure is labelled with its provenance. `src/domain/numbers.ts` names
three kinds, because a learner acts on them differently — you tune an
ASSUMPTION, look up a REFERENCE, and reproduce a MEASURED value. Calling all
three "assumption", as V1 did, taught learners to discount all three.

This is enforced in four ways:

0. `NumberChip` carries the kind as a glyph *and* a word, so the distinction
   survives a colour-blind reader and a greyscale print.
1. The `Assumption` component is used throughout the UI rather than left to
   prose discipline.
2. `CostResult.assumptions` and `PlannedTier.assumptions` are **required
   fields** — a model cannot return numbers without returning the assumptions
   behind them.
3. Every cost line item carries a `basis` string explaining its derivation, and
   the UI displays it next to the number.

Where comparison is qualitative (Architecture Comparison), the app deliberately
refuses to emit aggregate scores. Summing incommensurable axes hides the
decision instead of making it; the cells state engineering judgments you can
argue with instead.

The same refusal applies to the learner. The prediction record reports attempts
and how far each one landed, per topic, and never rolls them into a score, a
level or a streak. "You have been wrong about capacity three times" is a useful
sentence. "You are level 4" is not one.

The compliance model is the sharpest case: it states, in the model itself and
again in the UI, that it is an awareness check inside a simulator and not legal
advice. What it can check is whether the architecture has somewhere to *put* an
obligation — a retention policy, a redaction point, a residency boundary. Whether
a real deployment satisfies a real regulation is a question for people who do
that professionally.
