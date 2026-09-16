/**
 * Learning progression: 13 levels from "what is a component" to "solve
 * architecture challenges independently". Progress is tracked locally
 * (localStorage) and flags are set by the labs when their criteria are met.
 */

import type { LearningLevel } from './types'

export const LEARNING_LEVELS: LearningLevel[] = [
  {
    level: 1,
    title: 'Understand the components',
    goal: 'Know what each box in a voice architecture is and the problem it solves.',
    route: '/canvas',
    criteria: ['Open the Architecture Canvas', 'Inspect at least 5 components (click → read the panel)'],
    flag: 'inspected-components',
  },
  {
    level: 2,
    title: 'Build a basic voice pipeline',
    goal: 'Run a complete call through telephony → STT → LLM → TTS and read the event timeline.',
    route: '/call',
    criteria: ['Run a call in the Live Call Simulator', 'Click three events and read their payloads'],
    flag: 'ran-first-call',
  },
  {
    level: 3,
    title: 'Make it streaming',
    goal: 'See exactly which milliseconds streaming removes, stage by stage.',
    route: '/latency',
    criteria: ['Toggle batch vs streaming in the Latency Lab', 'Explain where the saved time comes from'],
    flag: 'compared-streaming',
  },
  {
    level: 4,
    title: 'Add natural conversation',
    goal: 'Tune VAD and endpointing; interrupt the agent mid-sentence and watch the cancellation cascade.',
    route: '/vad',
    criteria: ['Create a premature-cutoff with a short silence timeout', 'Run the barge-in simulation'],
    flag: 'tuned-vad',
  },
  {
    level: 5,
    title: 'Add tools and state',
    goal: 'Watch tool calls execute inside a live turn, and see where session state lives.',
    route: '/agent',
    criteria: ['Run a call with a tool call', 'Break the tool (timeout) and watch the recovery'],
    flag: 'used-tools',
  },
  {
    level: 6,
    title: 'Add telephony',
    goal: 'Understand SIP vs RTP, the mu-law 8 kHz reality, and what a carrier actually hands you.',
    route: '/telephony',
    criteria: ['Step through the SIP ladder', 'Explain why signalling and media take different paths'],
    flag: 'learned-telephony',
  },
  {
    level: 7,
    title: 'Add human handoff',
    goal: 'Run transfers that succeed, queue, and fail — and see why the no-agent branch is the design.',
    route: '/handoff',
    criteria: ['Run a successful warm transfer', 'Run the no-agent fallback path'],
    flag: 'ran-handoff',
  },
  {
    level: 8,
    title: 'Scale to hundreds of calls',
    goal: 'Size a media tier, see utilisation, meet your first bottleneck.',
    route: '/scaling',
    criteria: ['Load the 100-concurrent preset', 'Find the first component to saturate as you raise load'],
    flag: 'scaled-hundreds',
  },
  {
    level: 9,
    title: 'Scale to thousands',
    goal: 'Autoscaling with warmup lag, queue growth at saturation, blast-radius thinking.',
    route: '/scaling',
    criteria: ['Run the 1,000 and 10,000 presets', 'Watch a traffic spike outrun the autoscaler in the Observability view'],
    flag: 'scaled-thousands',
  },
  {
    level: 10,
    title: 'Design production architecture',
    goal: 'Feed requirements to the Decision Lab and follow every Requirement → Constraint → Decision → Tradeoff chain.',
    route: '/decisions',
    criteria: ['Generate an architecture from requirements', 'Disagree with one decision and articulate the tradeoff you would take instead'],
    flag: 'used-decision-engine',
  },
  {
    level: 11,
    title: 'Handle failures',
    goal: 'Inject failures, watch them propagate, then watch reliability patterns contain them.',
    route: '/chaos',
    criteria: ['Kill STT with and without a fallback', 'Compare naive vs production strategies in the Reliability Lab'],
    flag: 'injected-failures',
  },
  {
    level: 12,
    title: 'Optimize cost and latency',
    goal: 'Find the dominant cost line and the dominant latency segment, and move both.',
    route: '/cost',
    criteria: ['Identify the biggest line item at 5,000 calls/day', 'Apply two levers and check the annual delta'],
    flag: 'optimized-cost',
  },
  {
    level: 13,
    title: 'Solve challenges independently',
    goal: 'Take a generated brief, build the architecture yourself, and pass the evaluation.',
    route: '/challenge',
    criteria: ['Complete a challenge with no blocking issues', 'Read the feedback on every question, including the ones you got right'],
    flag: 'completed-challenge',
  },
]
