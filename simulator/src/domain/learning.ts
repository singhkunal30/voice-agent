/**
 * The guided course: the spine of the whole simulator.
 *
 * Twenty-six labs is a menu, not a curriculum. This file turns them into an
 * ordered path — five stages, thirteen steps — and every surface reads from it:
 * the course page, the rail carried into each lab, the prev/next footer, the
 * sidebar markers and the home page's "continue".
 *
 * Two rules keep the path honest:
 *
 *  1. A step is either `auto` (completed by an interaction the learner actually
 *     performs) or `self` (a judgment call they tick themselves). Visiting a
 *     page never completes anything — a progress bar you did not earn is worse
 *     than no progress bar.
 *  2. Each step says, in the learner's words, what "done" means here. The lab's
 *     own briefing says what to *click*; this says what you should be able to
 *     *say* afterwards.
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

export const COURSE_STAGES: CourseStage[] = [
  {
    id: 'foundations',
    title: 'Foundations',
    blurb: 'What the pieces are, and how one turn of conversation flows through them.',
  },
  {
    id: 'human',
    title: 'Make it feel human',
    blurb: 'Turn-taking, interruptions, tools and memory — the difference between a demo and a conversation.',
  },
  {
    id: 'realworld',
    title: 'Connect the real world',
    blurb: 'Phone networks and human colleagues, both of which have opinions.',
  },
  {
    id: 'production',
    title: 'Run it in production',
    blurb: 'Scale, design, failure and cost — everything that only shows up after launch.',
  },
  {
    id: 'prove',
    title: 'Prove it',
    blurb: 'Do it yourself, on a brief you have not seen before.',
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
    stageId: 'foundations',
    title: 'See why streaming wins',
    goal: 'Explain which milliseconds streaming removes, and which it cannot.',
    route: '/latency',
    criteria: ['Compare all-batch against all-streaming', 'Find the single longest bar in the waterfall'],
    completion: {
      kind: 'auto',
      flag: 'compared-streaming',
      trigger: 'Ticks once you have switched the pipeline between batch and streaming.',
    },
  },
  {
    n: 4,
    stageId: 'human',
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
    stageId: 'human',
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
    n: 6,
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
    n: 7,
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
    n: 8,
    stageId: 'production',
    title: 'Scale to hundreds of calls',
    goal: 'Size a fleet, and find what saturates before anything else does.',
    route: '/scaling',
    criteria: ['Raise the load past a hundred concurrent calls', 'Name the first component to run out of room'],
    completion: {
      kind: 'auto',
      flag: 'scaled-hundreds',
      trigger: 'Ticks once you have pushed the load past 100 concurrent calls yourself.',
    },
  },
  {
    n: 9,
    stageId: 'production',
    title: 'Scale to thousands',
    goal: 'Explain why a spike hurts even when autoscaling is switched on.',
    route: '/scaling',
    criteria: ['Push past a thousand concurrent calls', 'Watch a traffic spike outrun the autoscaler'],
    completion: {
      kind: 'auto',
      flag: 'scaled-thousands',
      trigger: 'Ticks once you have pushed the load past 1,000 concurrent calls yourself.',
    },
  },
  {
    n: 10,
    stageId: 'production',
    title: 'Break it on purpose',
    goal: 'Predict the blast radius of a dead dependency before you inject it.',
    route: '/chaos',
    criteria: ['Kill a provider mid-call', 'Run the same failure again with its mitigation switched on'],
    completion: {
      kind: 'auto',
      flag: 'injected-failures',
      trigger: 'Ticks once you have run a failure both with and without mitigations.',
    },
  },
  {
    n: 11,
    stageId: 'production',
    title: 'Move the money',
    goal: 'Find the dominant cost line and change it on purpose.',
    route: '/cost',
    criteria: ['Find the biggest line item at your volume', 'Apply a lever and check the annual difference'],
    completion: {
      kind: 'auto',
      flag: 'optimized-cost',
      trigger: 'Ticks once you have changed a pricing or volume input.',
    },
  },
  {
    n: 12,
    stageId: 'production',
    title: 'Design from requirements',
    goal: 'Turn a brief into an architecture, and defend every choice in it.',
    route: '/decisions',
    criteria: [
      'Generate an architecture from a set of requirements',
      'Find one decision you disagree with and say what you would trade instead',
    ],
    completion: {
      kind: 'self',
      flag: 'used-decision-engine',
      prompt: 'Can you argue against one of its decisions and say what you would give up?',
    },
  },
  {
    n: 13,
    stageId: 'prove',
    title: 'Do it without help',
    goal: 'Take an unseen brief, design for it, and survive the critique.',
    route: '/challenge',
    criteria: ['Submit a design with no blocking issues', 'Read the feedback on the answers you got right too'],
    completion: {
      kind: 'auto',
      flag: 'completed-challenge',
      trigger: 'Ticks once you have submitted a challenge design for evaluation.',
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

/** Every step that is worked in a given lab (two steps share /scaling). */
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

/** The step the learner should work on now, or null when the course is done. */
export function currentStep(progress: Progress): CourseStep | null {
  return COURSE_STEPS.find((s) => !isDone(s, progress)) ?? null
}

/**
 * Which step this lab represents *right now*.
 *
 * A lab can host more than one step (scaling hosts 8 and 9), so prefer the
 * first one still outstanding; if they are all done, show the last, because
 * that is the furthest the learner has come here.
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
