/**
 * Single source of truth for navigation.
 *
 * V1 had six menu groups, which is six things to hold in your head before you
 * have learned anything. V2 organises the same labs around the **five systems a
 * voice agent is actually made of**, because that is the mental model the whole
 * product is trying to install:
 *
 *   1. The voice loop  — audio in, audio out, and every millisecond between.
 *   2. The agent       — the thing that decides what to say and what to do.
 *   3. The network     — how audio physically reaches you.
 *   4. Production      — what changes when it is thousands of calls.
 *   5. Architecture    — designing the whole thing, and defending it.
 *
 * Crossing those systems is a second axis: **what you are doing right now.**
 * Building is not the same activity as breaking, and neither is diagnosing.
 * Each lab declares the modes it belongs to, and the workspace filters by mode
 * rather than duplicating the menu — the same twenty-nine labs, seen through
 * whichever lens matches the task in hand.
 *
 * Every surface reads from here: the sidebar, the command palette, the
 * prev/next footer, the home screen, the course.
 */

/** What you are doing, as distinct from what you are looking at. */
export type Mode = 'learn' | 'build' | 'simulate' | 'break' | 'diagnose' | 'challenge' | 'reference'

export interface ModeMeta {
  id: Mode
  label: string
  /** The verb, in the learner's words. */
  blurb: string
  icon: string
}

export const MODES: ModeMeta[] = [
  { id: 'learn', label: 'Learn', blurb: 'Follow the course, one step at a time.', icon: 'book' },
  { id: 'build', label: 'Build', blurb: 'Draw an architecture and have it critiqued.', icon: 'compass' },
  { id: 'simulate', label: 'Simulate', blurb: 'Run it and watch what actually happens.', icon: 'play' },
  { id: 'break', label: 'Break', blurb: 'Apply pressure and find what gives first.', icon: 'bolt' },
  { id: 'diagnose', label: 'Diagnose', blurb: 'Read the evidence and work out why.', icon: 'scope' },
  { id: 'challenge', label: 'Challenge', blurb: 'Design under constraints, without help.', icon: 'flag' },
  { id: 'reference', label: 'Reference', blurb: 'Look something up.', icon: 'book' },
]

export interface LabMeta {
  route: string
  label: string
  /** What you actually do on this page, in plain English. One short line. */
  blurb: string
  /** The question this lab answers — shown as the page's subtitle. */
  question: string
  /** Extra search terms for the command palette. */
  keywords: string[]
  /** Roughly how long a first pass takes, in minutes. */
  minutes: number
  /** Which activities this lab supports. */
  modes: Mode[]
  /** New in V2 — surfaced in the menu so returning learners can find it. */
  isNew?: boolean
}

export interface NavGroup {
  id: string
  title: string
  /** Why this group exists, for the group tooltip and the home screen. */
  blurb: string
  icon: string
  /** Systems are the mental model; chrome is everything else. */
  kind: 'system' | 'chrome'
  items: LabMeta[]
}

export const NAV_GROUPS: NavGroup[] = [
  {
    id: 'start',
    title: 'Start here',
    blurb: 'Where you are, what to do next, and what you are building it for.',
    icon: 'home',
    kind: 'chrome',
    items: [
      {
        route: '/',
        label: 'Workspace',
        blurb: 'Where you are, and what to do next.',
        question: 'What is this, and where should I start?',
        keywords: ['dashboard', 'overview', 'home', 'start', 'workspace'],
        minutes: 2,
        modes: ['learn', 'build', 'simulate', 'break', 'diagnose', 'challenge', 'reference'],
      },
      {
        route: '/learn',
        label: 'Guided course',
        blurb: 'Fifteen steps from "what is a component" to designing under pressure.',
        question: 'What order should I learn this in?',
        keywords: ['course', 'path', 'curriculum', 'levels', 'progress', 'syllabus'],
        minutes: 90,
        modes: ['learn'],
      },
      {
        route: '/scenarios',
        label: 'Scenarios',
        blurb: 'Pick a realistic brief. Every other lab then works on that brief.',
        question: 'What am I building, and for whom?',
        keywords: ['brief', 'requirements', 'use case', 'project', 'customer'],
        minutes: 5,
        modes: ['learn', 'build', 'challenge'],
      },
    ],
  },
  {
    id: 'voice-loop',
    title: 'The voice loop',
    blurb: 'Audio in, audio out, and every millisecond in between. One turn of conversation, taken apart.',
    icon: 'wave',
    kind: 'system',
    items: [
      {
        route: '/call',
        label: 'Live call',
        blurb: 'Play one complete call and watch every event as it fires.',
        question: 'What actually happens between "hello" and the reply?',
        keywords: ['simulator', 'timeline', 'events', 'run', 'playback', 'barge-in', 'turn'],
        minutes: 10,
        modes: ['learn', 'simulate', 'diagnose'],
      },
      {
        route: '/latency',
        label: 'Latency',
        blurb: 'Move one slider, watch the whole response budget recompute.',
        question: 'Why does the agent feel slow, and what can I actually fix?',
        keywords: ['speed', 'delay', 'streaming', 'batch', 'waterfall', 'budget', 'ttfb', 'response time'],
        minutes: 12,
        modes: ['learn', 'simulate', 'diagnose'],
      },
      {
        route: '/vad',
        label: 'Turn-taking',
        blurb: 'Tune when the agent decides you have stopped speaking.',
        question: 'Why does the agent interrupt me — or leave awkward pauses?',
        keywords: ['vad', 'endpointing', 'silence', 'barge-in', 'interrupt', 'turns', 'pauses'],
        minutes: 12,
        modes: ['learn', 'simulate'],
      },
      {
        route: '/stt',
        label: 'Speech to text',
        blurb: 'Watch partials firm up — then watch an accent and a second language break them.',
        question: 'How does audio become text, and where does it go wrong?',
        keywords: ['asr', 'transcription', 'recognition', 'partials', 'wer', 'accuracy', 'hindi', 'hinglish', 'accent', 'multilingual', 'code-switching'],
        minutes: 14,
        modes: ['learn', 'simulate', 'diagnose'],
      },
      {
        route: '/tts',
        label: 'Text to speech',
        blurb: 'See why the first audio chunk matters more than the rest.',
        question: 'How fast can the agent start talking?',
        keywords: ['voice', 'synthesis', 'speech', 'audio out', 'chunks', 'prosody'],
        minutes: 10,
        modes: ['learn', 'simulate'],
      },
      {
        route: '/audio',
        label: 'Audio formats',
        blurb: 'Build a pipeline hop by hop and see what each conversion costs.',
        question: 'Why does phone audio sound the way it does?',
        keywords: ['codec', 'pcm', 'opus', 'mulaw', 'sample rate', 'encoding', 'resample', 'bitrate'],
        minutes: 12,
        modes: ['learn', 'simulate', 'reference'],
      },
    ],
  },
  {
    id: 'agent',
    title: 'The agent',
    blurb: 'The part that decides what to say and what to do — and the part that decides whether anyone keeps using it.',
    icon: 'chip',
    kind: 'system',
    items: [
      {
        route: '/agent',
        label: 'Agent runtime',
        blurb: 'Run a turn with tool calls and watch state move.',
        question: 'Where does the thinking happen, and where does memory live?',
        keywords: ['llm', 'tools', 'function calling', 'context', 'prompt', 'state', 'session'],
        minutes: 12,
        modes: ['learn', 'simulate'],
      },
      {
        route: '/prompt',
        label: 'Prompts',
        blurb: 'Assemble a voice prompt section by section and see what each one buys.',
        question: 'What belongs in a voice prompt, and what does every token cost?',
        keywords: ['prompt', 'system prompt', 'instructions', 'guardrails', 'examples', 'tokens', 'tool docs'],
        minutes: 15,
        modes: ['build', 'diagnose'],
        isNew: true,
      },
      {
        route: '/quality',
        label: 'Agent quality',
        blurb: 'Run twelve realistic turns and see the six ways they go wrong.',
        question: 'Does the agent actually understand, choose and act correctly?',
        keywords: ['quality', 'accuracy', 'hallucination', 'tool selection', 'arguments', 'escalation', 'correctness'],
        minutes: 15,
        modes: ['simulate', 'diagnose'],
        isNew: true,
      },
      {
        route: '/eval',
        label: 'Evaluation',
        blurb: 'Turn quality into PASS / PARTIAL / FAIL, and compare two configurations.',
        question: 'How do I know a change made it better, and not just different?',
        keywords: ['eval', 'evaluation', 'regression', 'test suite', 'ab test', 'release gate', 'ship'],
        minutes: 15,
        modes: ['diagnose', 'challenge'],
        isNew: true,
      },
      {
        route: '/state-machines',
        label: 'Conversation state',
        blurb: 'Step through call and turn lifecycles one transition at a time.',
        question: 'What states can a call be in, and what breaks between them?',
        keywords: ['fsm', 'lifecycle', 'transitions', 'states', 'flow'],
        minutes: 10,
        modes: ['learn', 'reference'],
      },
    ],
  },
  {
    id: 'network',
    title: 'The network',
    blurb: 'How audio physically reaches your server, and who it has to be handed to next.',
    icon: 'server',
    kind: 'system',
    items: [
      {
        route: '/telephony',
        label: 'Telephony',
        blurb: 'Step through a SIP call setup and see where media goes.',
        question: 'What does a phone carrier actually hand my server?',
        keywords: ['sip', 'rtp', 'pstn', 'twilio', 'carrier', 'phone', 'did', 'trunk', 'dtmf'],
        minutes: 12,
        modes: ['learn', 'simulate', 'reference'],
      },
      {
        route: '/websocket',
        label: 'WebSockets',
        blurb: 'Stream audio over a socket and watch it survive a reconnect.',
        question: 'How does audio get from the browser to my server?',
        keywords: ['ws', 'streaming', 'socket', 'reconnect', 'backpressure', 'transport'],
        minutes: 10,
        modes: ['learn', 'simulate'],
      },
      {
        route: '/webrtc',
        label: 'WebRTC',
        blurb: 'Negotiate a peer connection and watch jitter get absorbed.',
        question: 'Why do browsers use WebRTC instead of a plain socket?',
        keywords: ['ice', 'stun', 'turn', 'sdp', 'peer', 'nat', 'jitter', 'browser'],
        minutes: 12,
        modes: ['learn', 'simulate'],
      },
      {
        route: '/handoff',
        label: 'Human handoff',
        blurb: 'Transfer to a human — and watch what happens when none exist.',
        question: 'How does the agent hand a call to a person?',
        keywords: ['transfer', 'escalation', 'human', 'agent', 'queue', 'warm transfer'],
        minutes: 10,
        modes: ['learn', 'simulate', 'break'],
      },
    ],
  },
  {
    id: 'production',
    title: 'Production',
    blurb: 'What changes when it is thousands of calls, someone is paying, and it is three in the morning.',
    icon: 'stack',
    kind: 'system',
    items: [
      {
        route: '/scaling',
        label: 'Scaling',
        blurb: 'Raise the call volume and find what saturates first.',
        question: 'What does 10 calls versus 10,000 calls actually cost me in servers?',
        keywords: ['infrastructure', 'capacity', 'autoscaling', 'load', 'concurrency', 'sizing', 'instances'],
        minutes: 15,
        modes: ['simulate', 'break', 'diagnose'],
      },
      {
        route: '/chaos',
        label: 'Break things',
        blurb: 'Kill a provider mid-call and watch the damage spread.',
        question: 'What happens when a dependency dies at the worst moment?',
        keywords: ['failure', 'chaos', 'outage', 'inject', 'fault', 'resilience', 'incident'],
        minutes: 12,
        modes: ['break', 'simulate'],
      },
      {
        route: '/reliability',
        label: 'Reliability patterns',
        blurb: 'Compare naive and hardened strategies against the same failures.',
        question: 'Which patterns actually contain a failure?',
        keywords: ['retry', 'circuit breaker', 'fallback', 'timeout', 'idempotency', 'redundancy'],
        minutes: 12,
        modes: ['break', 'build', 'reference'],
      },
      {
        route: '/cost',
        label: 'Cost',
        blurb: 'Find the biggest line item, then try to move it.',
        question: 'What does a minute of conversation cost, and who takes the money?',
        keywords: ['pricing', 'budget', 'spend', 'unit economics', 'margin', 'bill', 'money'],
        minutes: 12,
        modes: ['diagnose', 'build', 'challenge'],
      },
      {
        route: '/observability',
        label: 'Observability',
        blurb: 'The dashboards you would stare at during an incident.',
        question: 'How would I know this system is in trouble?',
        keywords: ['metrics', 'monitoring', 'dashboards', 'alerts', 'traces', 'logs', 'sre'],
        minutes: 10,
        modes: ['diagnose', 'break'],
      },
    ],
  },
  {
    id: 'architecture',
    title: 'Architecture',
    blurb: 'Designing the whole thing — then finding out what it was quietly assuming.',
    icon: 'compass',
    kind: 'system',
    items: [
      {
        route: '/canvas',
        label: 'Architecture canvas',
        blurb: 'Drag components together, have your design critiqued, and remove one to see what it was for.',
        question: 'Does the system I just drew actually hold up?',
        keywords: ['diagram', 'design', 'build', 'components', 'validate', 'draw', 'wire', 'what if', 'remove'],
        minutes: 18,
        modes: ['build', 'break'],
      },
      {
        route: '/pressure',
        label: 'Pressure tests',
        blurb: 'Ten changes the world makes to a design, applied one at a time.',
        question: 'What was this architecture quietly assuming would never change?',
        keywords: ['pressure', 'stress', 'what if', 'robustness', 'traffic', 'outage', 'compliance', 'security', 'privacy', 'gdpr', 'pci'],
        minutes: 20,
        modes: ['break', 'diagnose', 'challenge'],
        isNew: true,
      },
      {
        route: '/patterns',
        label: 'Reference patterns',
        blurb: 'Ten known-good architectures, from toy to platform.',
        question: 'What do real designs at each scale look like?',
        keywords: ['blueprint', 'template', 'examples', 'reference', 'starter'],
        minutes: 8,
        modes: ['build', 'reference'],
      },
      {
        route: '/decisions',
        label: 'Decision engine',
        blurb: 'Give it requirements, get an architecture with every reason shown.',
        question: 'How do requirements turn into technology choices?',
        keywords: ['tradeoffs', 'choices', 'requirements', 'rationale', 'adr', 'why'],
        minutes: 15,
        modes: ['build', 'learn'],
      },
      {
        route: '/compare',
        label: 'Compare designs',
        blurb: 'Put two architectures side by side on the numbers that matter.',
        question: 'Which of these two designs is better, and for what?',
        keywords: ['versus', 'comparison', 'evaluate', 'options', 'side by side'],
        minutes: 10,
        modes: ['diagnose', 'build'],
      },
      {
        route: '/challenge',
        label: 'Challenges',
        blurb: 'A brief, a budget, your design, an honest critique.',
        question: 'Can I do this without the training wheels?',
        keywords: ['test', 'exercise', 'practice', 'quiz', 'exam', 'interview', 'budget'],
        minutes: 25,
        modes: ['challenge'],
      },
    ],
  },
  {
    id: 'reference',
    title: 'Reference',
    blurb: 'Look something up without losing your place.',
    icon: 'book',
    kind: 'chrome',
    items: [
      {
        route: '/knowledge',
        label: 'Glossary',
        blurb: 'Every term in the simulator, answered the same eight ways.',
        question: 'What does that word mean?',
        keywords: ['dictionary', 'reference', 'terms', 'definitions', 'concepts', 'lookup', 'glossary'],
        minutes: 5,
        modes: ['reference'],
      },
    ],
  },
]

/** Flat, ordered list — drives prev/next and the command palette. */
export const ALL_LABS: LabMeta[] = NAV_GROUPS.flatMap((g) => g.items)

export const LAB_BY_ROUTE: Record<string, LabMeta> = Object.fromEntries(ALL_LABS.map((l) => [l.route, l]))

export const GROUP_BY_ROUTE: Record<string, NavGroup> = Object.fromEntries(
  NAV_GROUPS.flatMap((g) => g.items.map((i) => [i.route, g])),
)

/** Groups filtered to a mode, dropping any that end up empty. */
export function groupsInMode(mode: Mode | null): NavGroup[] {
  if (!mode) return NAV_GROUPS
  return NAV_GROUPS.map((g) => ({ ...g, items: g.items.filter((i) => i.modes.includes(mode)) })).filter(
    (g) => g.items.length > 0,
  )
}

/** Previous/next in reading order, skipping the workspace home. */
export function labNeighbours(route: string): { prev: LabMeta | null; next: LabMeta | null } {
  const ordered = ALL_LABS.filter((l) => l.route !== '/')
  const i = ordered.findIndex((l) => l.route === route)
  if (i === -1) return { prev: null, next: null }
  return { prev: ordered[i - 1] ?? null, next: ordered[i + 1] ?? null }
}
