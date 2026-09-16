# Voice Agent Lab

A workspace for designing, simulating, breaking and redesigning voice-agent
architectures.

You do not read diagrams here. You draw a system, commit to what you think it
will do, run it, find out you were wrong, and change it. Every number is
produced by a deterministic simulation and labelled with where it came from.

The workspace is organised around the five systems a voice agent is made of —
**the voice loop, the agent, the network, production, architecture** — and the
loop you work them in:

```
Design → Predict → Simulate → Observe → Explain → Redesign
```

Crossing that is a second axis: what you are *doing*. Building is not the same
activity as breaking, and neither is diagnosing. The mode chips in the sidebar
(Learn · Build · Simulate · Break · Diagnose · Challenge · Reference) filter the
same labs rather than duplicating the menu.

**No API keys. No external services. No network calls.** The entire simulation
runs in your browser.

### The one idea

Most learning tools show you an answer. This one hides it until you have
committed to your own. A lab that can measure something asks for a band first —
"where will perceived latency land?", "does this architecture hold under ten
times the traffic?" — and then puts your answer next to the measured one with a
*diagnosis* rather than a score:

- **exact** — your model produced the right answer.
- **one band out** — the shape of your model is right, a constant is wrong.
- **several bands out** — something in the causal chain is not where you think.

You can always skip the prediction. A skipped run is explicitly marked as
producing information rather than evidence, and the course only counts the
latter.

---

## Run it

```bash
npm install
npm run dev          # http://localhost:5173
```

That is the whole setup. No keys, no accounts, no services.

Production build — a static bundle you can serve from anywhere:

```bash
npm run build
npm run preview      # http://localhost:4173
```

The router is hash-based, so `dist/` works from any static host with no
server-side rewrite rules to configure.

### Verify

```bash
npm run verify       # typecheck + lint + 358 unit/integration tests + production build
npm test             # tests only
npm run smoke        # browser: every route renders, 19 interactions work (needs a preview server)
npm run coursecheck  # browser: the course thread holds and progress cannot be faked
npm run authcheck    # browser: all three Supabase configurations behave as designed
```

---

## Accounts and progress sync (optional)

The workspace keeps everything in `localStorage` and always has. Signing in
adds a **second** copy in Supabase so your record follows you to another
machine — it does not move your work off your device, and every lab behaves
identically signed out.

With no environment configured, the sign-in control does not appear at all.
That is the default, and it is the mode the browser test suites run in.

**1. Create the table.** Run
[`supabase/migrations/0001_learner_state.sql`](supabase/migrations/0001_learner_state.sql)
in your project's SQL editor. It creates one private row per learner and turns
on Row Level Security, which is the only thing standing between one learner and
everyone else's rows — read the comments at the top of that file before
changing it.

**2. Enable email auth.** Supabase dashboard → Authentication → Providers →
Email. Both email+password and emailed sign-in links are wired up.

**3. Point the app at it.**

```bash
cp .env.example .env    # git-ignored
# fill in VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY
```

> **The anon key, never the service-role key.** Every `VITE_*` variable is
> compiled into the JavaScript bundle and is readable by anyone who loads the
> page. The anon key is designed for that and carries no authority of its own.
> The service-role key bypasses RLS entirely; publishing one gives every
> visitor full access to your database. The app decodes the key at boot, and
> refuses to start the client if it finds a service-role claim — but the real
> protection is not putting it there.

### What syncs, and how conflicts are settled

Two copies that can both change need a merge rule, and "newest whole blob wins"
is the wrong one — it silently discards work done on the other device. So the
rule is chosen per field, from what the field actually is:

| | Rule | Why |
|---|---|---|
| Course progress | **Union** | A flag is written when you do something and never removed except by an explicit reset. Union is conflict-free: signing in on a new laptop can only add to what you had. |
| Prediction record | Append, dedupe on (question, timestamp), keep 200 | It is a log. |
| Working prompt | Newer whole wins | Merging it section by section would produce a prompt neither device chose. |
| Saved designs | Union by id, newer `savedAt` per id, keep 20 | Same cap the local store uses. |
| Theme, density, mode | **Does not sync** | A dark-theme laptop and a light-theme desktop is a preference, not a disagreement. |

The merge is pure and lives in [`src/state/sync.ts`](src/state/sync.ts), which
is why it has 26 tests and no network in sight. Losing connectivity never costs
you anything: the local copy is written first and is always authoritative.

`npm run authcheck` builds three real production bundles — no key, an anon key,
a service-role key — and checks each one in a browser: that sign-in is absent,
present, and refused-with-an-explanation respectively. The keys it uses are
synthetic and authenticate nothing.

---

## Finding your way around

The sidebar groups the labs into the five systems, filtered by whichever mode
you have selected, and only the group you are in stays open. Two shortcuts
matter more than the menu:

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
| **Workspace** | Where you left off, how your current design does under pressure, what you have predicted, the full lab map |
| **Guided course** | 15 steps in 6 stages. Eight of them need evidence rather than activity. The step follows you into each lab, so you never lose your place |
| **Scenarios** | 12 realistic briefs; activating one threads its requirements through every other lab |
| **Live call** | Run a full call: signalling → audio frames → VAD → STT → LLM → tools → TTS → playback. Interrupt it. Break it. |
| **Architecture canvas** | Drag, connect, configure, validate, simulate, export (JSON/PNG/SVG) |
| **Reference patterns** | 10 reference architectures, all editable |
| **Observability** | Simulated production console: spike → CPU → autoscale → queue → recovery |
| **Audio formats** | PCM, μ-law, Opus, sample rates, and detection of transcoding you didn't need |
| **Latency** | Closed-form waterfall; every input is a slider; streaming vs batch quantified |
| **Turn-taking** | Tune VAD against scripted audio containing a cough and a mid-sentence thinking pause |
| **Speech to text / Text to speech** | Simulated provider families; streaming vs batch; what noise and 8 kHz do to accuracy; and Hinglish code-switching as the honest hard case |
| **Agent runtime** | Context building, function calls, blocking vs async tools, failure recovery |
| **Conversation state** | Conversation / telephony / handoff machines — clickable, with timers and failure branches |
| **Telephony** | SIP ladder, RTP, DTMF, trunking — why signalling and media take different paths |
| **WebSockets** | Backpressure: watch an unbounded buffer convert a 3 s stall into permanent latency |
| **WebRTC** | SDP, ICE, STUN/TURN, and the browser-vs-phone architecture comparison |
| **Human handoff** | Availability check, queue, warm transfer, context transfer — and every failure branch |
| **Scaling** | Sizing, long-lived connections, autoscaling with warmup lag, multi-region failover |
| **Break things** | Arm failures, predict what the caller experiences, watch blast radius on the canvas, toggle mitigations, compare |
| **Pressure tests** | Ten changes the world makes to a design — 10× traffic, a vendor outage, +150 ms per hop, a 40% budget cut, a second language, four nines, tripled escalations, a second region, a 40× slower database, a queue backlog. Plus a data-exposure tab: every copy of caller data the pipeline creates |
| **Prompts** | A voice prompt as an engineering artefact: section by section, with the per-turn token cost and the failure each instruction prevents |
| **Agent quality** | Twelve realistic turns and the six ways they go wrong — misunderstood, wrong tool, wrong arguments, hallucination, lost state, missed and over escalation |
| **Evaluation** | PASS / PARTIAL / FAIL, a release gate on state-changing cases, regression comparison between two configurations, and a seed sweep |
| **Reliability patterns** | Retry, backoff, jitter, circuit breaker, fallback — measured against one outage |
| **Cost** | Per-call/day/month/year, editable pricing sheet, optimisation levers |
| **Decision engine** | Requirements in → architecture out, with every Requirement→Constraint→Decision→Tradeoff record |
| **Compare designs** | Batch vs streaming vs speech-to-speech vs hybrid, on explicit axes |
| **Challenges** | Generated brief *with a cost ceiling*, your design, an honest evaluation (nothing revealed before you submit) |
| **Glossary** | Concept cards, each answering the same eight questions |

---

## Project structure

```
├── src/
│   ├── domain/          Types, architecture builder DSL, learning progression
│   │   ├── types.ts     THE domain model — every lab reads these types
│   │   ├── builder.ts   Programmatic architecture construction
│   │   ├── learning.ts  The guided course — the spine every surface reads
│   │   ├── prediction.ts Questions, bands and diagnoses for the predict loop
│   │   └── numbers.ts   ASSUMPTION / REFERENCE / MEASURED provenance
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
│   │   ├── stateMachines.ts Conversation / telephony / handoff machines
│   │   ├── pressure.ts  Ten named changes applied to a design, re-using the models above
│   │   ├── prompt.ts    Voice prompt sections → behaviour factors + token cost
│   │   ├── agentQuality.ts The six ways a turn goes wrong, seeded and explainable
│   │   ├── evaluation.ts PASS/PARTIAL/FAIL, release gate, regressions, seed sweep
│   │   ├── whatIf.ts    Remove a component and report what it was for
│   │   ├── language.ts  Accent, telephony and code-switching effects on recognition
│   │   └── compliance.ts Every copy of caller data a voice pipeline creates
│   ├── providers/       STT/TTS/LLM/Telephony interfaces + simulated impls
│   ├── registry/        Component catalog (the single source of component truth)
│   ├── validation/      Architecture rules
│   ├── decision/        Decision engine + architecture comparison
│   ├── scenarios/       12 scenario briefs
│   ├── patterns/        10 reference architectures
│   ├── challenges/      Generator + evaluator
│   ├── knowledge/       Concept cards
│   ├── lib/supabase.ts  Optional Supabase client; refuses a service-role key
│   ├── state/           Zustand store (localStorage first), auth, and the sync merge
│   ├── ui/              Shared components (canvas, timeline, waterfall, controls, ⌘K palette)
│   │   └── Prediction.tsx The gate that hides results until you commit to an answer
│   ├── labs/            One file per section
│   ├── nav.ts           Five systems × seven modes — navigation, search, prev/next
│   └── theme.css        Colour, space and density tokens (Tailwind and the SVGs read the same vars)
├── scripts/smoke.mjs    Browser smoke test: every route, every key interaction
├── scripts/coursecheck.mjs Walks the course and fails if progress can be faked
└── supabase/migrations/ The learner_state table and its RLS policies
```

---

## The guided course

Twenty-nine labs is a menu, not a curriculum. `src/domain/learning.ts` turns
them into an ordered path — six stages, fifteen steps — and every surface reads
from it: the course page, the sidebar step numbers, the workspace's "continue",
the prev/next footer, and the **course rail**.

The rail is the important part. The course used to stop at the door of every
lab: you would pick step 4, land in the VAD lab, and lose all sense of where you
were, what counted as finished, or where to go next. The rail follows you in and
carries the step's number, its goal, what "done" means here, and the button that
continues the path. Labs that are *not* course steps say so, so reference
material does not read like a step you forgot.

Three rules keep it honest, and the third is the one that matters:

1. **Visiting a page never completes anything.** Progress you did not earn is
   worse than no progress bar — and this was a real bug in V1: five steps ticked
   on arrival, and the scaling lab completed two at once because its default
   load was already in the thousands.
2. **Each step states what "done" means** in the learner's words. The lab's own
   briefing says what to *click*; the step says what you should be able to *say*
   afterwards.
3. **Eight of the fifteen steps need evidence, not activity.** A step is `auto`
   (an interaction actually performed), `self` (a judgment call, used twice and
   only where nothing machine-checkable exists), or `evidence` — an artefact the
   learner produced:

   | Step | The artefact |
   |---|---|
   | 3 · Latency | A correct latency band, committed to before the waterfall appeared, plus having looked at both pipeline shapes |
   | 7 · Prompts | A prompt *you edited* down below 8% projected failures |
   | 8 · Agent quality | A configuration where silent state changes were present, then gone |
   | 9 · Evaluation | A change that fixed cases, regressed none, and opened the release gate |
   | 12 · Scaling | A correct tier prediction, made after pushing the load past a thousand concurrent calls |
   | 13 · Break things | A correct prediction of how a call ends, plus the same failure run with and without mitigations |
   | 14 · Pressure tests | A pressure test you turned from breaking to holding |
   | 15 · Challenges | A submitted design with no blocking issues that also fits the brief's cost ceiling |

   The prediction-backed ones cannot be earned by reading the answer first: the
   gate records the prediction *before* it reveals the measurement, and it
   refuses a second attempt on the same arming.

Cost and the decision engine left the path deliberately. Money is now a
constraint you design *against* — every generated challenge carries a budget
ceiling derived from what a reasonable design for those requirements costs — and
the budget-cut pressure test asks the same question with the architecture in
front of you.

`npm run coursecheck` walks the whole path in a browser and fails if the rail is
missing, names the wrong step, if touring every lab grants progress, if doing
the motions completes an evidence step without the evidence, or if naming a band
*after* seeing it counts as a prediction.

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

332 tests across eight suites:

| Suite | Covers |
|---|---|
| `engine/engine.test.ts` | PRNG determinism/distributions, heap ordering, virtual clock, event ordering, cancellation, step limits |
| `engine/callSim.test.ts` | Call event backbone, determinism, causal marker ordering, interruption, provider failures, handoff |
| `models/models.test.ts` | Audio arithmetic & pipeline grading, latency overlap semantics, cost shapes, scaling tiers, bottlenecks, autoscaling, regions, reliability strategies, VAD problems, state-machine reachability |
| `validation/validation.test.ts` | Registry/knowledge completeness, every validator rule, pattern integrity, decision-engine behaviour, challenge generation & evaluation |
| `integration.test.ts` | The twelve end-to-end scenarios (A–L), cross-cutting coherence, whole-app determinism |
| `models/v2.test.ts` | Pressure verdicts against every shipped pattern, recognition and code-switching monotonicity, prompt factor composition, quality couplings and expectation algebra, evaluation gates and regressions, removal consequences, compliance findings |
| `domain/learning.test.ts` | Course shape, progress semantics, the evidence split, and that no lab hosts an ambiguous number of steps |
| `domain/prediction.test.ts` | Band mapping, scoring and diagnosis, the per-topic record, number provenance |

Plus two browser suites: `npm run smoke` (every route renders with no console
errors, and nineteen key interactions work) and `npm run coursecheck` (the
course thread holds and progress cannot be faked).

The tests are not decoration — writing them surfaced eight real defects in V1,
including a cost total that disagreed with the sum of its line items, an
endpointer that could only ever commit one turn, a human tier staffed at 100%
occupancy (which queueing theory says is never a plan), and generated
architectures that were saturated the moment they were produced. Some of the V2
invariants they pin: per-kind quality expectations must sum exactly to the
overall expected failure rate; code-switched recognition is never easier than
monolingual; removing a component always names a gain as well as a break.

---

## On the numbers

V1 labelled every figure "simulation assumption", which was honest and
flattening. V2 splits it into three, because learners act on them differently:

| | What it is | What to do with it |
|---|---|---|
| **≈ assumption** | A value this simulator picked so the model has something to chew on | Change it and see whether the conclusion survives |
| **§ reference** | Fixed by a standard or by arithmetic — G.711 is 64 kbit/s because 8000 samples × 8 bits is 64,000 | Take it as given and design around it |
| **◉ measured** | Produced by a seeded run of this simulator | Reproduce it with the seed, change an input, re-measure |

A **measured** number is measured *inside the simulation*. That is the strongest
claim this application ever makes.

They are not measurements of any vendor's production system, and the simulator
does not claim to know how any real provider behaves. Provider profiles
("premium streaming TTS", "self-hosted batch STT") model *classes* of choice,
not products. Compliance content is educational architecture consideration, not
legal advice.

What transfers to real work is the reasoning: which constraint forced which
decision, and what it cost you.
