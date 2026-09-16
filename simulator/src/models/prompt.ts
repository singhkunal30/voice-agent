/**
 * Prompt engineering for voice, as an engineering artefact rather than prose.
 *
 * A voice agent's prompt is not a chat prompt with "be concise" appended. It
 * runs under constraints a text agent never sees:
 *
 *  - Every token in it is paid for on *every turn*, and the turn budget is a
 *    few hundred milliseconds. A long prompt is a latency decision.
 *  - The output is spoken, so markdown, bullet lists and parenthetical asides
 *    are not formatting problems — they are literally read aloud.
 *  - The caller can interrupt at any moment, so a three-sentence answer is
 *    three chances to be cut off before the useful part.
 *  - The transcript arriving is *wrong* some of the time. A prompt that assumes
 *    clean input produces confident answers to misheard questions.
 *
 * This model treats a prompt as a set of sections, each with real options and
 * a stated tradeoff, and derives behaviour factors that feed the agent-quality
 * simulation. The factors are ASSUMPTIONS about how instruction quality maps to
 * behaviour — the relationships are the lesson, not the constants.
 */

export interface PromptFactors {
  /** How unambiguous the agent's task and scope are. 0..1 */
  clarity: number
  /** How well the tools are described — names, when to use, argument rules. 0..1 */
  toolGrounding: number
  /** Explicit handling of uncertainty, refusal and "I don't know". 0..1 */
  guardrails: number
  /** Instructions to carry and re-use what the caller already said. 0..1 */
  stateDiscipline: number
  /** How clearly escalation is defined — when to transfer, when not to. 0..1 */
  escalationClarity: number
  /** How short and speakable the replies will be. 0..1 */
  brevity: number
}

export const ZERO_FACTORS: PromptFactors = {
  clarity: 0,
  toolGrounding: 0,
  guardrails: 0,
  stateDiscipline: 0,
  escalationClarity: 0,
  brevity: 0,
}

export interface PromptOption {
  id: string
  label: string
  /** The text this option contributes to the assembled prompt. */
  text: string
  effects: Partial<PromptFactors>
  /** What choosing this costs — there is always something. */
  tradeoff: string
}

export interface PromptSection {
  id: string
  title: string
  /** Why this section exists at all. */
  purpose: string
  options: PromptOption[]
}

export const PROMPT_SECTIONS: PromptSection[] = [
  {
    id: 'role',
    title: 'Role and scope',
    purpose:
      'What the agent is and — far more important — what it is not. An agent without a stated boundary will cheerfully attempt anything asked of it, which is where most hallucinations start.',
    options: [
      {
        id: 'none',
        label: 'No role statement',
        text: '',
        effects: { clarity: 0 },
        tradeoff: 'The model infers a role from the first turn. Different callers get different agents.',
      },
      {
        id: 'vague',
        label: 'Generic assistant',
        text: 'You are a helpful assistant for our company.',
        effects: { clarity: 0.3 },
        tradeoff: 'Reads fine and constrains nothing. "Helpful" is the instruction that produces invented order numbers.',
      },
      {
        id: 'scoped',
        label: 'Named role with an explicit out-of-scope list',
        text: [
          'You are the voice assistant for Meridian Retail. You handle exactly three things: order status, delivery rescheduling, and returns.',
          'You do not discuss pricing, promotions, other customers, or anything about Meridian as a company.',
          'If asked about anything outside those three, say you cannot help with that and offer to transfer.',
        ].join(' '),
        effects: { clarity: 0.9, guardrails: 0.3 },
        tradeoff:
          'Costs tokens on every turn, and a genuinely useful adjacent request now gets refused. That is the trade: a narrow agent that is right beats a broad one that is plausible.',
      },
    ],
  },
  {
    id: 'voice-style',
    title: 'Speaking style',
    purpose:
      'The output is audio. Anything that only makes sense on a screen — bullets, headings, asterisks, URLs — is a defect, and the model will not avoid it unless told.',
    options: [
      {
        id: 'none',
        label: 'No style guidance',
        text: '',
        effects: {},
        tradeoff:
          'Expect markdown read aloud as "asterisk asterisk", replies of four sentences where one was needed, and URLs spelled out character by character.',
      },
      {
        id: 'concise',
        label: '"Be concise"',
        text: 'Be concise.',
        effects: { brevity: 0.4 },
        tradeoff: 'Better than nothing and much weaker than it sounds. It shortens sentences without removing the structure that does not belong in speech.',
      },
      {
        id: 'spoken',
        label: 'Explicit spoken-output rules',
        text: [
          'You are speaking, not writing. Never use markdown, bullet points, asterisks, headings or emoji.',
          'Keep replies to one or two short sentences. Ask one question at a time and then stop.',
          'Say numbers the way a person would: "five five three seven", "twenty-third of March", "four hundred rupees".',
          'Never read out a URL or an email address unless the caller explicitly asks for it.',
        ].join(' '),
        effects: { brevity: 0.95, clarity: 0.2 },
        tradeoff:
          'About forty tokens on every single turn. It is almost always worth it: brevity is also the cheapest latency win, because the reply that is not generated is not synthesised either.',
      },
    ],
  },
  {
    id: 'tools',
    title: 'Tool documentation',
    purpose:
      'Tool-calling failures are rarely "the model cannot call tools". They are the model calling the right tool with the wrong arguments, or the wrong tool because two descriptions overlapped.',
    options: [
      {
        id: 'names',
        label: 'Tool names only',
        text: 'You have tools: lookup_order, reschedule_delivery, start_return.',
        effects: { toolGrounding: 0.2 },
        tradeoff:
          'The model guesses argument shapes from the name. It will pass the caller\'s phone number where an order id belongs, and the tool will return "not found" rather than "wrong argument".',
      },
      {
        id: 'described',
        label: 'Names plus one line each',
        text: [
          'lookup_order(order_id): returns status and delivery date for an order.',
          'reschedule_delivery(order_id, new_date): moves a delivery.',
          'start_return(order_id, reason): begins a return.',
        ].join(' '),
        effects: { toolGrounding: 0.6 },
        tradeoff: 'Good enough for the common path. Still ambiguous at the edges — what is a valid date, what happens with two open orders.',
      },
      {
        id: 'contracted',
        label: 'Full contract: arguments, formats, when NOT to call',
        text: [
          'lookup_order(order_id: string, exactly 4 digits). Call this only after the caller has given a complete order id. Never guess or complete a partial id.',
          'reschedule_delivery(order_id: string, new_date: ISO date). Call only after lookup_order has confirmed the order exists and the caller has confirmed the new date out loud.',
          'start_return(order_id: string, reason: one of damaged, wrong-item, no-longer-needed). If the reason does not match one of those, ask; do not map it yourself.',
          'If a tool returns an error, tell the caller what failed in one sentence. Never invent a result.',
        ].join(' '),
        effects: { toolGrounding: 0.95, guardrails: 0.3, clarity: 0.2 },
        tradeoff:
          'The longest section in the prompt, and the one that pays. Note what it mostly contains: preconditions and prohibitions, not descriptions.',
      },
    ],
  },
  {
    id: 'uncertainty',
    title: 'Uncertainty and misheard input',
    purpose:
      'The transcript is wrong some of the time — more on a phone, more with an accent, more with a code-switched sentence. A prompt that never mentions this produces an agent that acts confidently on a misheard order number.',
    options: [
      {
        id: 'none',
        label: 'Nothing about uncertainty',
        text: '',
        effects: {},
        tradeoff: 'The agent treats every transcript as exactly what was said. Wrong digits become wrong lookups, delivered with total confidence.',
      },
      {
        id: 'ask',
        label: 'Ask when unsure',
        text: 'If you are not sure what the caller said, ask them to repeat it.',
        effects: { guardrails: 0.4 },
        tradeoff: 'Helps, but "not sure" is doing a lot of unspecified work, and the model is a poor judge of its own transcript confidence.',
      },
      {
        id: 'readback',
        label: 'Mandatory read-back of identifiers',
        text: [
          'The transcript you receive may contain recognition errors, especially in numbers, names and addresses.',
          'Always read an order id, phone number or date back to the caller and get an explicit confirmation before using it in a tool call.',
          'If the caller corrects you, use the correction and do not re-ask.',
          'Never state a fact you did not receive from a tool. If you do not have it, say you do not have it.',
        ].join(' '),
        effects: { guardrails: 0.95, stateDiscipline: 0.3 },
        tradeoff:
          'Adds a turn to every transaction, which callers notice. It is still the single highest-value instruction in a phone agent, because the failure it prevents is silent and expensive.',
      },
    ],
  },
  {
    id: 'state',
    title: 'Memory discipline',
    purpose:
      'Callers do not repeat themselves, and they are right not to. An agent that asks for the order number a second time has told the caller it was not listening the first time.',
    options: [
      {
        id: 'none',
        label: 'No memory instruction',
        text: '',
        effects: {},
        tradeoff: 'Whether the agent remembers depends entirely on what survived context trimming. It will re-ask, at random, on longer calls.',
      },
      {
        id: 'remember',
        label: 'Carry confirmed facts forward',
        text: [
          'Keep track of everything the caller has already confirmed in this call: order id, dates, addresses, the reason for their call.',
          'Never ask for something you have already been given. If you need to check it, read it back rather than asking again.',
        ].join(' '),
        effects: { stateDiscipline: 0.9 },
        tradeoff:
          'Instructions alone cannot rescue a context window that has dropped the turn. This has to be paired with a context strategy that keeps confirmed facts, which is a system design decision, not a prompt one.',
      },
    ],
  },
  {
    id: 'escalation',
    title: 'Escalation policy',
    purpose:
      'Both failure directions are expensive. An agent that never transfers traps angry callers; an agent that transfers at the first difficulty is an expensive phone menu.',
    options: [
      {
        id: 'none',
        label: 'No escalation guidance',
        text: '',
        effects: {},
        tradeoff: 'The model decides, differently each time. Escalation rate becomes a number you cannot explain or move.',
      },
      {
        id: 'onrequest',
        label: 'Transfer when asked',
        text: 'If the caller asks for a human, transfer them.',
        effects: { escalationClarity: 0.5 },
        tradeoff: 'Misses the caller who is clearly stuck but has not thought to ask, which is most of them.',
      },
      {
        id: 'explicit',
        label: 'Named triggers, in both directions',
        text: [
          'Transfer to a human when: the caller asks for one; the caller is distressed or angry; the same request has failed twice; or the request involves a refund over ten thousand rupees.',
          'Do not transfer merely because a question is outside your three topics — say you cannot help with that first, and transfer only if they still want to continue.',
          'When you transfer, tell the caller what you are doing and what you have already established, so they do not start again.',
        ].join(' '),
        effects: { escalationClarity: 0.95, guardrails: 0.2 },
        tradeoff:
          'Every named trigger is a policy decision someone has to own. The "failed twice" rule in particular will change your staffing numbers, which is a conversation worth having before you deploy it and not after.',
      },
    ],
  },
  {
    id: 'examples',
    title: 'Worked examples',
    purpose:
      'Examples pin down behaviour that prose cannot: how short is short, what a read-back sounds like, what to do with a half-heard order number.',
    options: [
      {
        id: 'none',
        label: 'No examples',
        text: '',
        effects: {},
        tradeoff: 'Free, and leaves the hardest-to-describe behaviour (tone, length, recovery) entirely to the model.',
      },
      {
        id: 'happy',
        label: 'One happy-path example',
        text: 'Example. Caller: "where is order five five three seven". You: "Order five five three seven is out for delivery today. Anything else?"',
        effects: { brevity: 0.2, clarity: 0.2 },
        tradeoff: 'Teaches length and tone. Teaches nothing about the cases that actually go wrong.',
      },
      {
        id: 'failure',
        label: 'Examples of the failure cases',
        text: [
          'Example. Caller: "where is order five five three" — that is only three digits. You: "I need four digits — was that five five three, and then one more?"',
          'Example. A tool returns an error. You: "I can\'t reach the order system right now. Shall I have someone call you back?"',
          'Example. Caller says something out of scope. You: "I can\'t help with pricing, but I can check an order or a return."',
        ].join(' '),
        effects: { guardrails: 0.4, toolGrounding: 0.2, clarity: 0.3 },
        tradeoff:
          'Examples are the most expensive tokens in the prompt, paid on every turn. Spend them on the behaviour you cannot describe in a rule — which is almost always recovery, not success.',
      },
    ],
  },
]

export type PromptSelection = Record<string, string>

/** The empty-but-valid starting point: every section at its weakest option. */
export const MINIMAL_SELECTION: PromptSelection = Object.fromEntries(
  PROMPT_SECTIONS.map((s) => [s.id, s.options[0].id]),
)

/** Everything at its strongest. Useful as a comparison, not as a default. */
export const MAXIMAL_SELECTION: PromptSelection = Object.fromEntries(
  PROMPT_SECTIONS.map((s) => [s.id, s.options[s.options.length - 1].id]),
)

export interface ComposedPrompt {
  text: string
  /** Approximate tokens. ASSUMPTION: ~1.35 tokens per whitespace word. */
  tokens: number
  factors: PromptFactors
  /** Problems with this particular combination of choices. */
  warnings: { title: string; detail: string }[]
}

export function composePrompt(selection: PromptSelection): ComposedPrompt {
  const parts: string[] = []
  const factors: PromptFactors = { ...ZERO_FACTORS }

  for (const section of PROMPT_SECTIONS) {
    const chosen = section.options.find((o) => o.id === selection[section.id]) ?? section.options[0]
    if (chosen.text) parts.push(chosen.text)
    for (const [k, v] of Object.entries(chosen.effects) as [keyof PromptFactors, number][]) {
      // Sections reinforce rather than override: two sections that both push
      // toward brevity should not cancel, but neither should they exceed 1.
      factors[k] = Math.min(1, Math.max(factors[k], v) + Math.min(factors[k], v) * 0.3)
    }
  }

  const text = parts.join('\n\n')
  const tokens = Math.round(text.split(/\s+/).filter(Boolean).length * 1.35)

  const warnings: { title: string; detail: string }[] = []
  if (factors.toolGrounding > 0.5 && factors.guardrails < 0.4) {
    warnings.push({
      title: 'Well-documented tools, no instruction about bad input',
      detail:
        'The agent knows exactly how to call the tools and nothing about whether the arguments it heard are real. Precise calls with misheard order numbers are still wrong answers — they just fail further downstream.',
    })
  }
  if (factors.stateDiscipline > 0.5 && factors.clarity < 0.4) {
    warnings.push({
      title: 'Told to remember, not told what matters',
      detail:
        'Without a stated scope, "remember what the caller said" means remembering everything, which in a limited context window means remembering the wrong things.',
    })
  }
  if (factors.brevity < 0.5) {
    warnings.push({
      title: 'No spoken-output constraint',
      detail:
        'This prompt will produce text-shaped answers. On a phone that means markdown read aloud, multi-part answers the caller interrupts halfway through, and longer synthesis on every single turn.',
    })
  }
  if (tokens > 420) {
    warnings.push({
      title: `Long prompt: about ${tokens} tokens on every turn`,
      detail:
        'Prompt tokens are paid per turn, not per call. At eight turns a call this is roughly eight times this number in input tokens, and it lands in time-to-first-token — the part of latency the caller feels as hesitation.',
    })
  }
  if (factors.escalationClarity < 0.3) {
    warnings.push({
      title: 'Escalation is undefined',
      detail:
        'The model will still escalate — just unpredictably. An escalation rate you cannot explain is an escalation rate you cannot staff for.',
    })
  }

  return { text, tokens, factors, warnings }
}

/** Overall instruction quality, for the quality model's single-number inputs. */
export function instructionQuality(f: PromptFactors): number {
  const weights: [keyof PromptFactors, number][] = [
    ['clarity', 0.22],
    ['toolGrounding', 0.24],
    ['guardrails', 0.24],
    ['stateDiscipline', 0.12],
    ['escalationClarity', 0.1],
    ['brevity', 0.08],
  ]
  return weights.reduce((sum, [k, w]) => sum + f[k] * w, 0)
}
