/**
 * Prompt engineering for voice.
 *
 * Assemble a system prompt section by section and watch three things move at
 * once: what the agent will now do reliably, what it costs in tokens on every
 * single turn, and which combinations are internally inconsistent.
 *
 * The prompt built here is shared state — the Agent Quality and Evaluation
 * labs run against exactly this prompt, so a change made on this page shows up
 * as a different set of failing turns two clicks away. That coupling is the
 * point: prompt engineering only becomes engineering when there is a
 * measurement on the other end of it.
 */

import { useEffect, useMemo, useRef } from 'react'
import { Link } from 'react-router-dom'
import { useAppStore } from '../state/store'
import {
  MAXIMAL_SELECTION,
  MINIMAL_SELECTION,
  PROMPT_SECTIONS,
  composePrompt,
  instructionQuality,
  type PromptFactors,
} from '../models/prompt'
import { expectedFailureRate, DEFAULT_QUALITY_CONFIG } from '../models/agentQuality'
import { Callout, Meter, NumberChip, PageHeader, Panel, Stat, Takeaway } from '../ui/primitives'

const FACTOR_LABELS: { key: keyof PromptFactors; label: string; what: string }[] = [
  { key: 'clarity', label: 'Task clarity', what: 'How unambiguous the job and its boundary are.' },
  { key: 'toolGrounding', label: 'Tool grounding', what: 'Whether the agent knows when NOT to call each tool.' },
  { key: 'guardrails', label: 'Uncertainty handling', what: 'What happens when the transcript is wrong or the answer is unknown.' },
  { key: 'stateDiscipline', label: 'Memory discipline', what: 'Whether confirmed facts are carried forward.' },
  { key: 'escalationClarity', label: 'Escalation policy', what: 'Named triggers in both directions — when to transfer and when not to.' },
  { key: 'brevity', label: 'Speakability', what: 'How short and how spoken-shaped the replies will be.' },
]

export default function PromptLab() {
  const selection = useAppStore((s) => s.promptSelection)
  const setSelection = useAppStore((s) => s.setPromptSelection)
  const markProgress = useAppStore((s) => s.markProgress)

  const composed = useMemo(() => composePrompt(selection), [selection])
  const quality = instructionQuality(composed.factors)

  // The projected failure rate uses the same model the Quality lab runs, so
  // the number here and the number there cannot drift apart.
  const projected = useMemo(
    () => expectedFailureRate({ ...DEFAULT_QUALITY_CONFIG, factors: composed.factors }),
    [composed.factors],
  )

  // Evidence, not attendance: the step needs a prompt the learner *edited*
  // down below 8% projected failures. Arriving with a good prompt already
  // saved from a previous session does not count.
  const editedHere = useRef(false)
  useEffect(() => {
    if (editedHere.current && projected < 0.08) markProgress('prompt-prevents-failure')
  }, [projected, selection, markProgress])

  const pick = (sectionId: string, optionId: string) => {
    editedHere.current = true
    setSelection({ ...selection, [sectionId]: optionId })
    markProgress('engineered-prompt')
  }

  // Tokens are paid per turn, not per call — the single most misunderstood
  // fact about prompt cost in a voice agent.
  const turnsPerCall = 8
  const perCallTokens = composed.tokens * turnsPerCall

  return (
    <div className="p-5">
      <PageHeader
        title="Prompt engineering"
        steps={[
          'Start at the top with everything on its weakest setting and read the warnings.',
          'Turn on "Explicit spoken-output rules" and watch the token cost appear — that is paid on every turn, not every call.',
          'Turn on "Mandatory read-back of identifiers" and watch the projected failure rate move.',
          'Then take it to Agent Quality and see which specific turns changed.',
        ]}
        subtitle={
          <>
            A voice prompt is not a chat prompt with &ldquo;be concise&rdquo; appended. It runs under constraints a text
            agent never sees: every token is paid on <i>every turn</i> inside a few-hundred-millisecond budget, the
            output is spoken so markdown is read aloud, the caller can interrupt at any moment, and the transcript
            arriving is wrong some of the time. Each section below has a real cost as well as a real benefit.
          </>
        }
        right={
          <div className="flex items-center gap-2">
            <button className="btn btn-sm" onClick={() => setSelection(MINIMAL_SELECTION)}>
              Reset to minimal
            </button>
            <button className="btn btn-sm" onClick={() => setSelection(MAXIMAL_SELECTION)}>
              Everything on
            </button>
          </div>
        }
      />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr),22rem]">
        <div className="space-y-3">
          {PROMPT_SECTIONS.map((section) => {
            const chosenId = selection[section.id] ?? section.options[0].id
            return (
              <Panel key={section.id} title={section.title}>
                <p className="mb-3 text-sm leading-relaxed text-ink-400">{section.purpose}</p>
                <div className="space-y-1.5">
                  {section.options.map((o) => {
                    const active = o.id === chosenId
                    return (
                      <button
                        key={o.id}
                        onClick={() => pick(section.id, o.id)}
                        aria-pressed={active}
                        className={`block w-full rounded-md border px-3 py-2.5 text-left transition-colors ${
                          active
                            ? 'border-accent-dim bg-accent-deep/20'
                            : 'border-ink-800 bg-ink-850/40 hover:border-ink-600 hover:bg-ink-850'
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <span
                            className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border text-2xs ${
                              active ? 'border-accent bg-accent text-ink-950' : 'border-ink-600 text-transparent'
                            }`}
                            aria-hidden
                          >
                            ✓
                          </span>
                          <span className={`text-sm font-medium ${active ? 'text-accent' : 'text-ink-100'}`}>
                            {o.label}
                          </span>
                          {o.text && (
                            <span className="ml-auto shrink-0 font-mono text-2xs text-ink-500">
                              +{Math.round(o.text.split(/\s+/).filter(Boolean).length * 1.35)} tok
                            </span>
                          )}
                        </div>
                        <p className="mt-1 pl-6 text-xs leading-relaxed text-ink-400">{o.tradeoff}</p>
                      </button>
                    )
                  })}
                </div>
              </Panel>
            )
          })}
        </div>

        <div className="space-y-3">
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-1">
            <Stat
              label="Prompt size"
              value={composed.tokens}
              unit="tokens"
              hint="Approximate, at ~1.35 tokens per word. An editable assumption — tokenisers differ."
            />
            <Stat
              label={`Input tokens per call (~${turnsPerCall} turns)`}
              value={perCallTokens.toLocaleString()}
              tone={perCallTokens > 3000 ? 'warn' : 'default'}
              hint="Prompt tokens are re-sent on every turn. This is the number that lands in time-to-first-token, which the caller hears as hesitation."
            />
            <Stat
              label="Projected turns going wrong"
              value={`${(projected * 100).toFixed(0)}%`}
              tone={projected < 0.08 ? 'good' : projected < 0.18 ? 'warn' : 'bad'}
              hint="From the same quality model the Agent Quality lab runs, holding everything except the prompt constant."
            />
          </div>

          <Panel title="What this prompt makes reliable" right={<NumberChip kind="ASSUMPTION" source="Instruction quality → behaviour mapping" />}>
            <div className="space-y-2.5">
              {FACTOR_LABELS.map((f) => (
                <Meter
                  key={f.key}
                  value={composed.factors[f.key]}
                  label={<span title={f.what}>{f.label}</span>}
                  caption={`${Math.round(composed.factors[f.key] * 100)}%`}
                  tone={composed.factors[f.key] > 0.66 ? 'good' : composed.factors[f.key] > 0.33 ? 'warn' : 'bad'}
                />
              ))}
            </div>
            <p className="mt-3 text-2xs leading-relaxed text-ink-500">
              These are modelled couplings between instruction quality and behaviour, not measurements of any model.
              What they encode is which instructions prevent which failures — the ordering is the lesson, not the
              percentages.
            </p>
          </Panel>

          {composed.warnings.length > 0 && (
            <Panel title={`${composed.warnings.length} problem${composed.warnings.length > 1 ? 's' : ''} with this combination`}>
              <div className="space-y-2">
                {composed.warnings.map((w, i) => (
                  <div key={i} className="rounded-md border border-warn/30 bg-warn/[0.05] px-3 py-2">
                    <div className="text-sm font-medium text-ink-100">
                      <span className="mr-1.5" aria-hidden>
                        ⚠
                      </span>
                      {w.title}
                    </div>
                    <p className="mt-1 text-xs leading-relaxed text-ink-400">{w.detail}</p>
                  </div>
                ))}
              </div>
            </Panel>
          )}

          <Takeaway title="The part people get backwards">
            Most of a good voice prompt is <b>preconditions and prohibitions</b>, not descriptions. &ldquo;Never guess a
            partial order id&rdquo; prevents a class of silent failure; &ldquo;lookup_order returns order status&rdquo;
            prevents nothing, because the model could already infer it from the name.
          </Takeaway>

          <div className="panel-pad">
            <div className="text-sm font-medium text-ink-100">Now measure it</div>
            <p className="mt-1 text-xs leading-relaxed text-ink-500">
              This prompt is shared with the quality and evaluation labs. Run it against twelve realistic turns and see
              which ones it actually changed.
            </p>
            <div className="mt-2.5 flex gap-2">
              <Link to="/quality" className="btn btn-sm btn-primary">
                Agent Quality →
              </Link>
              <Link to="/eval" className="btn btn-sm">
                Evaluation →
              </Link>
            </div>
          </div>
        </div>
      </div>

      <Panel className="mt-4" title="The assembled prompt" right={<span className="font-mono text-2xs text-ink-500">{composed.tokens} tokens</span>}>
        {composed.text ? (
          <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded-md border border-ink-800 bg-ink-950/60 p-3 font-mono text-xs leading-relaxed text-ink-300">
            {composed.text}
          </pre>
        ) : (
          <Callout tone="warn" title="This prompt is empty">
            An agent with no instructions is not a minimal agent — it is an unpredictable one. It will still answer,
            differently each time, and you will have no way to say why.
          </Callout>
        )}
        <p className="mt-2 text-2xs text-ink-500">
          Overall instruction quality: {(quality * 100).toFixed(0)}% — a weighted blend of the factors above, used only
          to order comparisons between prompts. It is not a grade.
        </p>
      </Panel>
    </div>
  )
}
