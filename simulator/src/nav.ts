/**
 * Single source of truth for navigation.
 *
 * Every surface that needs to talk about labs — the sidebar, the command
 * palette, the prev/next footer, the dashboard, the course — reads from here.
 * Each lab carries a plain-English `blurb` (what you do there) and a
 * `question` (what you walk away knowing), so navigation can be read by
 * someone who does not yet know the jargon.
 */

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
}

export interface NavGroup {
  id: string
  title: string
  /** Why this group exists, for the group tooltip and the dashboard. */
  blurb: string
  icon: string
  items: LabMeta[]
}

export const NAV_GROUPS: NavGroup[] = [
  {
    id: 'start',
    title: 'Start here',
    blurb: 'Get oriented and pick something to work on.',
    icon: 'home',
    items: [
      {
        route: '/',
        label: 'Home',
        blurb: 'Where you are, and what to do next.',
        question: 'What is this, and where should I start?',
        keywords: ['dashboard', 'overview', 'home', 'start'],
        minutes: 2,
      },
      {
        route: '/learn',
        label: 'Guided course',
        blurb: '13 steps from "what is a component" to designing under pressure.',
        question: 'What order should I learn this in?',
        keywords: ['course', 'path', 'curriculum', 'levels', 'progress', 'syllabus'],
        minutes: 90,
      },
      {
        route: '/scenarios',
        label: 'Scenarios',
        blurb: 'Pick a realistic brief. Every other lab then works on that brief.',
        question: 'What am I building, and for whom?',
        keywords: ['brief', 'requirements', 'use case', 'project', 'customer'],
        minutes: 5,
      },
    ],
  },
  {
    id: 'see',
    title: 'See it work',
    blurb: 'Watch a whole voice agent run before taking it apart.',
    icon: 'play',
    items: [
      {
        route: '/call',
        label: 'Live call',
        blurb: 'Play one complete call and watch every event as it fires.',
        question: 'What actually happens between "hello" and the reply?',
        keywords: ['simulator', 'timeline', 'events', 'run', 'playback', 'barge-in', 'turn'],
        minutes: 10,
      },
      {
        route: '/canvas',
        label: 'Architecture canvas',
        blurb: 'Drag components together and have your design critiqued.',
        question: 'Does the system I just drew actually hold up?',
        keywords: ['diagram', 'design', 'build', 'components', 'validate', 'draw', 'wire'],
        minutes: 15,
      },
      {
        route: '/patterns',
        label: 'Reference patterns',
        blurb: 'Ten known-good architectures, from toy to platform.',
        question: 'What do real designs at each scale look like?',
        keywords: ['blueprint', 'template', 'examples', 'reference', 'starter'],
        minutes: 8,
      },
      {
        route: '/observability',
        label: 'Observability',
        blurb: 'The dashboards you would stare at during an incident.',
        question: 'How would I know this system is in trouble?',
        keywords: ['metrics', 'monitoring', 'dashboards', 'alerts', 'traces', 'logs', 'sre'],
        minutes: 10,
      },
    ],
  },
  {
    id: 'audio',
    title: 'The audio path',
    blurb: 'Sound in, sound out — and every millisecond in between.',
    icon: 'wave',
    items: [
      {
        route: '/audio',
        label: 'Audio formats',
        blurb: 'Build a pipeline hop by hop and see what each conversion costs.',
        question: 'Why does phone audio sound the way it does?',
        keywords: ['codec', 'pcm', 'opus', 'mulaw', 'sample rate', 'encoding', 'resample', 'bitrate'],
        minutes: 12,
      },
      {
        route: '/latency',
        label: 'Latency',
        blurb: 'Move one slider, watch the whole response budget recompute.',
        question: 'Why does the agent feel slow, and what can I actually fix?',
        keywords: ['speed', 'delay', 'streaming', 'batch', 'waterfall', 'budget', 'ttfb', 'response time'],
        minutes: 12,
      },
      {
        route: '/vad',
        label: 'Turn-taking',
        blurb: 'Tune when the agent decides you have stopped speaking.',
        question: 'Why does the agent interrupt me — or leave awkward pauses?',
        keywords: ['vad', 'endpointing', 'silence', 'barge-in', 'interrupt', 'turns', 'pauses'],
        minutes: 12,
      },
      {
        route: '/stt',
        label: 'Speech to text',
        blurb: 'Watch partial transcripts firm up word by word.',
        question: 'How does audio become text, and where does it go wrong?',
        keywords: ['asr', 'transcription', 'recognition', 'partials', 'wer', 'accuracy'],
        minutes: 10,
      },
      {
        route: '/tts',
        label: 'Text to speech',
        blurb: 'See why the first audio chunk matters more than the rest.',
        question: 'How fast can the agent start talking?',
        keywords: ['voice', 'synthesis', 'speech', 'audio out', 'chunks', 'prosody'],
        minutes: 10,
      },
    ],
  },
  {
    id: 'runtime',
    title: 'The brain and the wires',
    blurb: 'The agent logic, and how audio physically reaches it.',
    icon: 'chip',
    items: [
      {
        route: '/agent',
        label: 'Agent runtime',
        blurb: 'Run a turn with tool calls and watch state move.',
        question: 'Where does the thinking happen, and where does memory live?',
        keywords: ['llm', 'tools', 'function calling', 'context', 'prompt', 'state', 'session'],
        minutes: 12,
      },
      {
        route: '/state-machines',
        label: 'Conversation state',
        blurb: 'Step through call and turn lifecycles one transition at a time.',
        question: 'What states can a call be in, and what breaks between them?',
        keywords: ['fsm', 'lifecycle', 'transitions', 'states', 'flow'],
        minutes: 10,
      },
      {
        route: '/telephony',
        label: 'Telephony',
        blurb: 'Step through a SIP call setup and see where media goes.',
        question: 'What does a phone carrier actually hand my server?',
        keywords: ['sip', 'rtp', 'pstn', 'twilio', 'carrier', 'phone', 'did', 'trunk', 'dtmf'],
        minutes: 12,
      },
      {
        route: '/websocket',
        label: 'WebSockets',
        blurb: 'Stream audio over a socket and watch it survive a reconnect.',
        question: 'How does audio get from the browser to my server?',
        keywords: ['ws', 'streaming', 'socket', 'reconnect', 'backpressure', 'transport'],
        minutes: 10,
      },
      {
        route: '/webrtc',
        label: 'WebRTC',
        blurb: 'Negotiate a peer connection and watch jitter get absorbed.',
        question: 'Why do browsers use WebRTC instead of a plain socket?',
        keywords: ['ice', 'stun', 'turn', 'sdp', 'peer', 'nat', 'jitter', 'browser'],
        minutes: 12,
      },
      {
        route: '/handoff',
        label: 'Human handoff',
        blurb: 'Transfer to a human — and watch what happens when none exist.',
        question: 'How does the agent hand a call to a person?',
        keywords: ['transfer', 'escalation', 'human', 'agent', 'queue', 'warm transfer'],
        minutes: 10,
      },
    ],
  },
  {
    id: 'production',
    title: 'Running it for real',
    blurb: 'What changes when it is thousands of calls and someone is paying.',
    icon: 'server',
    items: [
      {
        route: '/scaling',
        label: 'Scaling',
        blurb: 'Raise the call volume and find what saturates first.',
        question: 'What does 10 calls versus 10,000 calls actually cost me in servers?',
        keywords: ['infrastructure', 'capacity', 'autoscaling', 'load', 'concurrency', 'sizing', 'instances'],
        minutes: 15,
      },
      {
        route: '/chaos',
        label: 'Break things',
        blurb: 'Kill a provider mid-call and watch the damage spread.',
        question: 'What happens when a dependency dies at the worst moment?',
        keywords: ['failure', 'chaos', 'outage', 'inject', 'fault', 'resilience', 'incident'],
        minutes: 12,
      },
      {
        route: '/reliability',
        label: 'Reliability patterns',
        blurb: 'Compare naive and hardened strategies against the same failures.',
        question: 'Which patterns actually contain a failure?',
        keywords: ['retry', 'circuit breaker', 'fallback', 'timeout', 'idempotency', 'redundancy'],
        minutes: 12,
      },
      {
        route: '/cost',
        label: 'Cost',
        blurb: 'Find the biggest line item, then try to move it.',
        question: 'What does a minute of conversation cost, and who takes the money?',
        keywords: ['pricing', 'budget', 'spend', 'unit economics', 'margin', 'bill', 'money'],
        minutes: 12,
      },
    ],
  },
  {
    id: 'architect',
    title: 'Think like an architect',
    blurb: 'Make the calls yourself, and defend them.',
    icon: 'compass',
    items: [
      {
        route: '/decisions',
        label: 'Decision engine',
        blurb: 'Give it requirements, get an architecture with every reason shown.',
        question: 'How do requirements turn into technology choices?',
        keywords: ['tradeoffs', 'choices', 'requirements', 'rationale', 'adr', 'why'],
        minutes: 15,
      },
      {
        route: '/compare',
        label: 'Compare designs',
        blurb: 'Put two architectures side by side on the numbers that matter.',
        question: 'Which of these two designs is better, and for what?',
        keywords: ['versus', 'comparison', 'evaluate', 'options', 'side by side'],
        minutes: 10,
      },
      {
        route: '/challenge',
        label: 'Challenges',
        blurb: 'A brief, your design, an honest critique.',
        question: 'Can I do this without the training wheels?',
        keywords: ['test', 'exercise', 'practice', 'quiz', 'exam', 'interview'],
        minutes: 20,
      },
      {
        route: '/knowledge',
        label: 'Glossary',
        blurb: 'Every term in the simulator, answered the same eight ways.',
        question: 'What does that word mean?',
        keywords: ['dictionary', 'reference', 'terms', 'definitions', 'concepts', 'lookup', 'glossary'],
        minutes: 5,
      },
    ],
  },
]

/** Flat, ordered list — drives prev/next and the command palette. */
export const ALL_LABS: LabMeta[] = NAV_GROUPS.flatMap((g) => g.items)

export const LAB_BY_ROUTE: Record<string, LabMeta> = Object.fromEntries(
  ALL_LABS.map((l) => [l.route, l]),
)

export const GROUP_BY_ROUTE: Record<string, NavGroup> = Object.fromEntries(
  NAV_GROUPS.flatMap((g) => g.items.map((i) => [i.route, g])),
)

/** Previous/next in reading order, skipping Home. */
export function labNeighbours(route: string): { prev: LabMeta | null; next: LabMeta | null } {
  const ordered = ALL_LABS.filter((l) => l.route !== '/')
  const i = ordered.findIndex((l) => l.route === route)
  if (i === -1) return { prev: null, next: null }
  return { prev: ordered[i - 1] ?? null, next: ordered[i + 1] ?? null }
}
