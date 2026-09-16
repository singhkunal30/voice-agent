/**
 * The guided course: the spine of the whole workspace.
 *
 * Twenty-nine labs is a menu, not a curriculum. This file turns them into an
 * ordered path — six stages, fifteen steps — and every surface reads from it:
 * the course page, the rail carried into each lab, the prev/next footer, the
 * sidebar markers and the workspace's "continue".
 *
 * Three rules keep the path honest, and the third is new in V2:
 *
 *  1. Visiting a page never completes anything. A progress bar you did not
 *     earn is worse than no progress bar.
 *  2. Each step says, in the learner's words, what "done" means here. The lab's
 *     own briefing says what to *click*; this says what you should be able to
 *     *say* afterwards.
 *  3. **Most steps need evidence, not activity.** Eight of the fifteen require
 *     an artefact the learner produced: a prediction they committed to before
 *     looking and got right, a quality problem they diagnosed and removed, a
 *     change that improved an evaluation without regressing it, an
 *     architecture they turned from breaking to holding under pressure.
 *
 * Rule 3 is the difference between "I did the latency lab" and "I can predict
 * where latency lands". The first is attendance. Only the second is learning,
 * and only the second is hard to fake — which is the point, because the person
 * being fooled by an unearned progress bar is the learner.
 */

export interface CourseStage {
  id: string
  title: string
  /** What this stage is for, in one line. */
  blurb: string
}

export type Completion =
  | {
      kind: 'auto'
      /** Progress flag the lab sets when the learner does the real thing. */
      flag: string
      /** Plain-English description of what triggers it. */
      trigger: string
    }
  | {
      kind: 'self'
      flag: string
      /** The question the learner answers honestly before ticking. */
      prompt: string
    }
  | {
      kind: 'evidence'
      /**
       * Flag set only when the learner produces the artefact.
       *
       * Where the artefact includes a prediction, the lab checks the store's
       * `predicted:<questionId>` flag, which is written only for a prediction
       * that was committed to before the result was visible *and* turned out
       * to be right. Reading the answer first cannot earn it.
       */
      flag: string
      /** The artefact, named. */
      artefact: string
      /** How to produce it, concretely. */
      how: string
    }

export interface CourseStep {
  /** 1-based position in the course. */
  n: number
  stageId: string
  title: string
  /** What you can do after this step that you could not before. */
  goal: string
  /** The lab this step is worked in. */
  route: string
  /** What "done" means here. Short, checkable. */
  criteria: string[]
  completion: Completion
}

/** Flag written when a prediction on `questionId` is committed to and correct. */
export function predictionFlag(questionId: string): string {
  return `predicted:${questionId}`
}

export const COURSE_STAGES: CourseStage[] = [
  {
    id: 'foundations',
    title: 'Foundations',
    blurb: 'What the pieces are, and how one turn of conversation flows through them.',
  },
  {
    id: 'voice-loop',
    title: 'The voice loop',
    blurb: 'Latency, turn-taking and recognition — the difference between a demo and a conversation.',
  },
  {
    id: 'agent',
    title: 'The agent',
    blurb: 'What it says, what it does, and how you find out whether any of it is right.',
  },
  {
    id: 'realworld',
    title: 'The real world',
    blurb: 'Phone networks and human colleagues, both of which have opinions.',
  },
  {
    id: 'production',
    title: 'Production',
    blurb: 'Scale, failure and cost — everything that only shows up after launch.',
  },
  {
    id: 'prove',
    title: 'Prove it',
    blurb: 'Find what your design assumed, then do it again on a brief you have not seen.',
  },
]

export const COURSE_STEPS: CourseStep[] = [
  {
    n: 1,
    stageId: 'foundations',
    title: 'Understand the components',
    goal: 'Name every box in a voice architecture and say what problem it solves.',
    route: '/canvas',
    criteria: ['Open five different components and read what each one is for'],
    completion: {
      kind: 'auto',
      flag: 'inspected-components',
      trigger: 'Ticks once you have opened five components on the canvas.',
    },
  },
  {
    n: 2,
    stageId: 'foundations',
    title: 'Follow one call end to end',
    goal: 'Trace a single turn from audio in to audio out, and name each hop.',
    route: '/call',
    criteria: ['Play a complete call', 'Open three events and read what moved'],
    completion: {
      kind: 'auto',
      flag: 'ran-first-call',
      trigger: 'Ticks once you have played a call and inspected three of its events.',
    },
  },
  {
    n: 3,
    stageId: 'voice-loop',
    title: 'Predict where latency lands',
    goal: 'Say, before running it, which milliseconds streaming removes and which it cannot.',
    route: '/latency',
    criteria: [
      'Put the pipeline into all-batch and all-streaming, and look at both',
      'Commit to a latency band before the waterfall is revealed, and be right',
    ],
    completion: {
      kind: 'evidence',
      flag: 'latency-predicted',
      artefact: 'A correct latency prediction, plus having seen both the batch and the streaming pipeline.',
      how: 'The Latency lab hides the waterfall until you pick a band. Getting it wrong costs nothing and teaches more; getting it right — having looked at both pipeline shapes — is what completes this step.',
    },
  },
  {
    n: 4,
    stageId: 'voice-loop',
    title: 'Tune turn-taking',
    goal: 'Say why an agent interrupts people, and what it costs to stop it.',
    route: '/vad',
    criteria: [
      'Make the agent cut someone off mid-thought with a short silence timeout',
      'Then make it wait — and notice what that costs every other turn',
    ],
    completion: {
      kind: 'auto',
      flag: 'tuned-vad',
      trigger: 'Ticks once your settings have produced a premature cut-off.',
    },
  },
  {
    n: 5,
    stageId: 'voice-loop',
    title: 'Hear what recognition gets wrong',
    goal: 'Explain why a misheard order number is a data-integrity problem, not a speech problem.',
    route: '/stt',
    criteria: [
      'Run the same sentence through a narrowband and a wideband channel',
      'Switch the recogniser between code-switch-aware and not, and watch the error rate move',
    ],
    completion: {
      kind: 'auto',
      flag: 'compared-recognition',
      trigger: 'Ticks once you have changed how the pipeline handles code-switching and seen the effect.',
    },
  },
  {
    n: 6,
    stageId: 'agent',
    title: 'Add tools and memory',
    goal: 'Decide which work belongs inside a turn and which belongs after it.',
    route: '/agent',
    criteria: ['Run a turn that calls a tool', 'Break that tool and watch the recovery path'],
    completion: {
      kind: 'auto',
      flag: 'used-tools',
      trigger: 'Ticks once you have run a turn with a tool call and then failed it.',
    },
  },
  {
    n: 7,
    stageId: 'agent',
    title: 'Write a prompt that prevents a failure',
    goal: 'Name the instruction that prevents each failure mode, and what it costs per turn.',
    route: '/prompt',
    criteria: [
      'Assemble a prompt whose projected failure rate falls below 8%',
      'Be able to say which single section bought the most, and what it costs in tokens',
    ],
    completion: {
      kind: 'evidence',
      flag: 'prompt-prevents-failure',
      artefact: 'A prompt you edited that projects under 8% of turns going wrong.',
      how: 'Change sections in the Prompt lab until the projected failure rate drops below 8%. Arriving with a good prompt already saved does not count — the step needs an edit you made.',
    },
  },
  {
    n: 8,
    stageId: 'agent',
    title: 'Find the failure nobody notices',
    goal: 'Diagnose a silent state change and remove it.',
    route: '/quality',
    criteria: [
      'Get a run that changes data incorrectly without signalling an error',
      'Change the configuration until that stops happening, and know which change did it',
    ],
    completion: {
      kind: 'evidence',
      flag: 'quality-no-silent-mutations',
      artefact: 'A configuration you fixed: silent state changes present, then gone.',
      how: 'You have to see the problem before you can fix it — the step needs both a run with silent mutations and a later run without them.',
    },
  },
  {
    n: 9,
    stageId: 'agent',
    title: 'Decide whether to ship it',
    goal: 'Turn a quality change into a release decision you could defend in review.',
    route: '/eval',
    criteria: [
      'Produce a comparison where cases improve, nothing regresses, and the gate opens',
      'Be able to name one case that changed and say why',
    ],
    completion: {
      kind: 'evidence',
      flag: 'eval-clean-improvement',
      artefact: 'An evaluation where something improved, nothing regressed, and the release gate opened.',
      how: 'Change the prompt, come back, and compare. A change that fixes three cases and breaks one is not this artefact — that is the point of it.',
    },
  },
  {
    n: 10,
    stageId: 'realworld',
    title: 'Connect a phone network',
    goal: 'Explain what a carrier hands your server, and why signalling and audio arrive separately.',
    route: '/telephony',
    criteria: ['Step through a call setup', 'Say in your own words why SIP and RTP take different paths'],
    completion: {
      kind: 'self',
      flag: 'learned-telephony',
      prompt: 'Could you explain the SIP/RTP split to someone else without looking?',
    },
  },
  {
    n: 11,
    stageId: 'realworld',
    title: 'Hand off to a human',
    goal: 'Design a transfer that still works when no human is available.',
    route: '/handoff',
    criteria: ['Run a transfer that succeeds', 'Run the one where nobody picks up'],
    completion: {
      kind: 'auto',
      flag: 'ran-handoff',
      trigger: 'Ticks once you have run both the successful and the no-agent transfer.',
    },
  },
  {
    n: 12,
    stageId: 'production',
    title: 'Predict what a load needs',
    goal: 'Say what shape of system a given load requires, before the model tells you.',
    route: '/scaling',
    criteria: [
      'Push the load past a thousand concurrent calls',
      'Commit to a tier before the bill of materials appears, and be right',
    ],
    completion: {
      kind: 'evidence',
      flag: 'scaling-predicted',
      artefact: 'A correct prediction of the tier a load needs, made after you had pushed the load past a thousand concurrent calls.',
      how: 'The interesting wrong answer is one tier too high: distribution feels like the grown-up choice long before the arithmetic asks for it.',
    },
  },
  {
    n: 13,
    stageId: 'production',
    title: 'Predict the blast radius',
    goal: 'Say what a dead dependency does to the caller, before you inject it.',
    route: '/chaos',
    criteria: [
      'Arm a failure and commit to what the caller experiences, correctly',
      'Run the same failure with mitigations on and with them off',
    ],
    completion: {
      kind: 'evidence',
      flag: 'chaos-predicted',
      artefact: 'A correct prediction of how a call ends, plus the same failure run both with and without mitigations.',
      how: 'A failure a fallback absorbs and a failure that drops the call look identical on a status page. Committing to one first is how you find out whether you know the difference.',
    },
  },
  {
    n: 14,
    stageId: 'prove',
    title: 'Find what your design assumed',
    goal: 'Take an architecture that breaks under pressure and make it hold.',
    route: '/pressure',
    criteria: [
      'Find a pressure test this design fails',
      'Change the architecture so the same test passes',
    ],
    completion: {
      kind: 'evidence',
      flag: 'pressure-redesigned',
      artefact: 'A pressure test you turned from breaking to holding.',
      how: 'Run the tests, find one that breaks, open the canvas, make the change the finding names, and run the same test again. The second verdict is the one that counts.',
    },
  },
  {
    n: 15,
    stageId: 'prove',
    title: 'Do it without help, to a budget',
    goal: 'Take an unseen brief with a cost ceiling, design for it, and survive the critique.',
    route: '/challenge',
    criteria: [
      'Submit a design with no blocking issues',
      'Come in under the budget the brief sets — every reliability question is easy when money is free',
    ],
    completion: {
      kind: 'evidence',
      flag: 'challenge-passed',
      artefact: 'A submitted design with no blocking issues that also fits the brief\u2019s cost ceiling.',
      how: 'Submitting is not passing. The brief carries a budget derived from what a reasonable design for those requirements costs, so buying your way out of every tradeoff puts you over it.',
    },
  },
]

// ---------------------------------------------------------------------------
// Derived lookups — every surface reads the course through these.
// ---------------------------------------------------------------------------

export const COURSE_LENGTH = COURSE_STEPS.length

export const STEPS_BY_STAGE: Record<string, CourseStep[]> = Object.fromEntries(
  COURSE_STAGES.map((s) => [s.id, COURSE_STEPS.filter((step) => step.stageId === s.id)]),
)

/** Every step that is worked in a given lab. */
export function stepsForRoute(route: string): CourseStep[] {
  return COURSE_STEPS.filter((s) => s.route === route)
}

export function isCourseRoute(route: string): boolean {
  return COURSE_STEPS.some((s) => s.route === route)
}

export type Progress = Record<string, boolean>

export function isDone(step: CourseStep, progress: Progress): boolean {
  return Boolean(progress[step.completion.flag])
}

export function doneCount(progress: Progress): number {
  return COURSE_STEPS.filter((s) => isDone(s, progress)).length
}

/** Steps that need an artefact rather than an activity. */
export const EVIDENCE_STEPS: CourseStep[] = COURSE_STEPS.filter((s) => s.completion.kind === 'evidence')

export function evidenceCount(progress: Progress): number {
  return EVIDENCE_STEPS.filter((s) => isDone(s, progress)).length
}

/** The step the learner should work on now, or null when the course is done. */
export function currentStep(progress: Progress): CourseStep | null {
  return COURSE_STEPS.find((s) => !isDone(s, progress)) ?? null
}

/**
 * Which step this lab represents *right now*.
 *
 * A lab can host more than one step, so prefer the first one still
 * outstanding; if they are all done, show the last, because that is the
 * furthest the learner has come here.
 */
export function activeStepForRoute(route: string, progress: Progress): CourseStep | null {
  const steps = stepsForRoute(route)
  if (steps.length === 0) return null
  return steps.find((s) => !isDone(s, progress)) ?? steps[steps.length - 1]
}

/** Neighbours in course order — used when the learner is following the path. */
export function courseNeighbours(step: CourseStep): { prev: CourseStep | null; next: CourseStep | null } {
  const i = COURSE_STEPS.findIndex((s) => s.n === step.n)
  return { prev: COURSE_STEPS[i - 1] ?? null, next: COURSE_STEPS[i + 1] ?? null }
}

export function stageOf(step: CourseStep): CourseStage {
  return COURSE_STAGES.find((s) => s.id === step.stageId) ?? COURSE_STAGES[0]
}

/** Course-step number for a lab route, for sidebar and map markers. */
export const STEP_NUMBERS_BY_ROUTE: Record<string, number[]> = COURSE_STEPS.reduce<Record<string, number[]>>(
  (acc, s) => {
    (acc[s.route] ??= []).push(s.n)
    return acc
  },
  {},
)
