/**
 * Scenario library — realistic briefs the whole app plays against.
 * Each scenario defines requirements, the interesting difficulties (crux),
 * a reference pattern, and a sample call the Live Call Simulator can run.
 */

import type { Requirements, Scenario } from '../domain/types'

const req = (over: Partial<Requirements> & { name: string }): Requirements => ({
  callsPerDay: 1000,
  avgCallSeconds: 240,
  peakCallsPerMinute: 10,
  peakConcurrentCalls: 50,
  latencyTargetMs: 1000,
  availabilityTarget: 0.99,
  languages: ['en-US'],
  regions: ['us-east'],
  direction: 'inbound',
  channel: 'phone',
  humanHandoff: false,
  recording: false,
  toolUsage: 0.3,
  budgetPosture: 'balanced',
  compliance: [],
  ...over,
})

export const SCENARIOS: Scenario[] = [
  {
    id: 'sc-browser-assistant',
    name: 'Browser voice assistant',
    tagline: 'A "talk to our AI" button on a product page.',
    story:
      'A SaaS company adds a voice assistant to its docs site. Users click, grant mic access, and ask product questions. No phone numbers, no telephony — but the internet between a home Wi-Fi and your servers is now your carrier.',
    requirements: req({
      name: 'Browser voice assistant', channel: 'browser', callsPerDay: 800, peakConcurrentCalls: 30,
      latencyTargetMs: 700, toolUsage: 0.2,
    }),
    referencePatternId: 'pat-browser',
    crux: [
      'WebRTC vs WebSocket transport for browser audio',
      'NAT traversal: STUN, and TURN for the users who need it',
      '48 kHz browser audio is an STT accuracy gift — do not resample it away carelessly',
    ],
    learningGoals: ['webrtc', 'ice', 'opus', 'vad'],
    sampleUtterance: 'Hey, how do I set up single sign on for my team?',
    tools: ['search'],
  },
  {
    id: 'sc-support-simple',
    name: 'Simple customer support agent',
    tagline: 'Answer the phone, check an order, book a slot.',
    story:
      'A retailer replaces its IVR maze with an agent that can actually do the two things 80% of callers want: order status and appointment booking. This is the scenario this repository\'s real voice-agent code implements.',
    requirements: req({
      name: 'Simple support agent', callsPerDay: 1500, peakConcurrentCalls: 60, latencyTargetMs: 1000,
      recording: true, toolUsage: 0.8,
    }),
    referencePatternId: 'pat-phone-agent',
    crux: [
      'Tool calls (order lookup, booking) land inside live turns — timeout budgets and filler speech',
      'Idempotent booking: retried tool calls must not double-book (a unique constraint is the last line of defense)',
      'Telephony audio is 8 kHz: expect and design for lower STT accuracy on order IDs — confirm them aloud',
    ],
    learningGoals: ['function-calling', 'idempotency', 'timeout-budgets'],
    sampleUtterance: 'Can you check the status of my order? It is O R D one zero zero one.',
    tools: ['customer lookup', 'order lookup', 'calendar booking'],
  },
  {
    id: 'sc-outbound-sales',
    name: 'Outbound sales agent',
    tagline: 'The dialer calls; a human might answer. Or a voicemail. Or a dog.',
    story:
      'A lender runs payment-reminder and offer campaigns. The system dials from a queue, detects answering machines, speaks to humans, and books follow-ups. Outbound flips the telephony problem: YOU pay for every second, and carrier dial-rate quotas pace everything.',
    requirements: req({
      name: 'Outbound sales agent', direction: 'outbound', callsPerDay: 25000, peakConcurrentCalls: 300,
      latencyTargetMs: 1000, budgetPosture: 'low-cost', recording: true,
    }),
    referencePatternId: 'pat-sales',
    crux: [
      'Dialer pacing against calls-per-second quotas and answer rates',
      'Answering-machine detection: seconds of cost per wrong guess at scale',
      'Unit economics rule: cost/call decides whether the campaign runs at all',
    ],
    learningGoals: ['telephony', 'cost', 'queues'],
    sampleUtterance: 'Hello? Who is this?',
    tools: ['CRM', 'calendar'],
  },
  {
    id: 'sc-insurance',
    name: 'Insurance sales agent',
    tagline: '“What is the premium for a one crore policy?”',
    story:
      'An Indian insurer sells term policies over the phone. The agent quotes premiums, explains riders in Hindi or English, and hands regulated advice to licensed humans. This scenario drives the Live Call Simulator\'s default call.',
    requirements: req({
      name: 'Insurance sales agent', callsPerDay: 5000, peakConcurrentCalls: 500, latencyTargetMs: 800,
      availabilityTarget: 0.999, languages: ['hi-IN', 'en-IN'], regions: ['in-mumbai'], humanHandoff: true,
      recording: true, toolUsage: 0.6,
    }),
    referencePatternId: 'pat-handoff',
    crux: [
      'Hindi/English code-switching drives the STT choice',
      'Premium calculation is a tool call inside a live turn',
      'Regulated moments must escalate to licensed humans — handoff is a designed state machine',
    ],
    learningGoals: ['stt', 'human-handoff', 'function-calling'],
    sampleUtterance: 'I want to know the premium for a one crore insurance policy',
    tools: ['customer lookup', 'premium calculator', 'policy lookup', 'CRM'],
  },
  {
    id: 'sc-appointments',
    name: 'Appointment booking agent',
    tagline: 'A clinic\'s phone line that never rings busy.',
    story:
      'A clinic chain books, moves and cancels appointments by phone. Deceptively simple — until two callers want the last Tuesday slot at the same instant, or a webhook retry books it twice.',
    requirements: req({
      name: 'Appointment booking', callsPerDay: 2000, peakConcurrentCalls: 80, latencyTargetMs: 1000,
      recording: false, toolUsage: 0.9,
    }),
    referencePatternId: 'pat-support',
    crux: [
      'Concurrency on a shared calendar: uniqueness lives in the database, not in the agent',
      'Idempotency keys derived from (call, slot, customer) — this repo\'s handlers.py shows the exact pattern',
      'Date/time entity extraction is where STT errors hurt the most: always confirm aloud',
    ],
    learningGoals: ['idempotency', 'postgres', 'function-calling'],
    sampleUtterance: 'I would like to book an appointment for Tuesday at ten thirty in the morning.',
    tools: ['calendar', 'customer lookup'],
  },
  {
    id: 'sc-interviewer',
    name: 'AI interviewer',
    tagline: 'A screening interview that listens more than it talks.',
    story:
      'A recruiting platform runs first-round screens by voice. Long user turns (minutes, not seconds), thoughtful pauses that must NOT be treated as end-of-turn, and full recording for human review.',
    requirements: req({
      name: 'AI interviewer', channel: 'browser', callsPerDay: 400, peakConcurrentCalls: 40,
      latencyTargetMs: 1500, recording: true, avgCallSeconds: 1500, toolUsage: 0.1,
    }),
    referencePatternId: 'pat-browser',
    crux: [
      'Endpointing tuned for thinking pauses: a 600 ms timeout interrupts candidates mid-thought; try 1200+ ms',
      '25-minute calls stress connection lifetime: idle LB timeouts, memory per session, reconnect + resume',
      'Turn detection vs VAD is the whole product here',
    ],
    learningGoals: ['turn-detection', 'vad', 'websocket'],
    sampleUtterance: 'Well... let me think about that for a second. I would probably start by profiling the query.',
    tools: ['question bank', 'scoring rubric'],
  },
  {
    id: 'sc-support-handoff',
    name: 'AI customer service + human handoff',
    tagline: 'The AI handles 70%; the other 30% must reach a human gracefully.',
    story:
      'A telco fronts its support line with AI. Frustration detection, explicit requests and policy triggers escalate to a staffed queue with warm transfer and full context. The handoff path IS the product\'s reputation.',
    requirements: req({
      name: 'Support + handoff', callsPerDay: 8000, peakConcurrentCalls: 400, latencyTargetMs: 900,
      availabilityTarget: 0.999, humanHandoff: true, recording: true, toolUsage: 0.5,
    }),
    referencePatternId: 'pat-handoff',
    crux: [
      'Escalation policy: too eager wastes humans, too stubborn enrages callers',
      'Queue with honest wait estimates + callback fallback when wait exceeds policy',
      'Context transfer: the human must never say “can you repeat all that?”',
    ],
    learningGoals: ['human-handoff', 'state-machines', 'queues'],
    sampleUtterance: 'I have already explained this twice. Let me talk to a real person.',
    tools: ['CRM', 'ticketing', 'agent presence'],
  },
  {
    id: 'sc-1k-concurrent',
    name: '1,000 concurrent outbound calls',
    tagline: 'The dialer wants a thousand lines at once.',
    story:
      'A collections platform runs 1,000 simultaneous outbound calls at peak. This is where architecture stops being a diagram exercise: ~29 media servers, connection-aware balancing, quota-paced dialing, and a queue that absorbs every side effect.',
    requirements: req({
      name: '1k concurrent outbound', direction: 'outbound', callsPerDay: 100000, peakConcurrentCalls: 1000,
      latencyTargetMs: 1000, availabilityTarget: 0.999, recording: true, budgetPosture: 'low-cost',
    }),
    referencePatternId: 'pat-outbound-scale',
    crux: [
      'Capacity math: instances = concurrent / per-instance / headroom — do it before the campaign starts',
      'Provider quotas (STT streams, TTS concurrency, LLM TPM) are the real ceilings',
      'One media server dying drops 50 calls: blast radius is a chosen number',
    ],
    learningGoals: ['load-balancing', 'autoscaling', 'queues'],
    sampleUtterance: 'Yes, this is she. What is this regarding?',
    tools: ['CRM', 'payment API'],
  },
  {
    id: 'sc-10k-concurrent',
    name: '10,000+ concurrent calls',
    tagline: 'A national election-week helpline.',
    story:
      'A government helpline must absorb 10,000+ concurrent calls across three regions during surge weeks. Multi-region media, regional state, failure isolation and honest queueing when even that is not enough.',
    requirements: req({
      name: '10k concurrent platform', callsPerDay: 600000, peakConcurrentCalls: 10000, latencyTargetMs: 900,
      availabilityTarget: 0.9995, regions: ['in-mumbai', 'us-east', 'eu-west'], humanHandoff: true, recording: true,
    }),
    referencePatternId: 'pat-multiregion',
    crux: [
      'Regional media termination: physics beats software across oceans',
      'Region failure is a designed-for event: N-1 sizing, drills, honest degradation',
      'Distributed session state: region-local, with an explicit consistency story',
    ],
    learningGoals: ['multi-region', 'autoscaling', 'observability'],
    sampleUtterance: 'I need to find my polling station for Tuesday.',
    tools: ['registry lookup', 'search'],
  },
  {
    id: 'sc-india-multilingual',
    name: 'Multilingual India-focused voice agent',
    tagline: 'Hindi, English, and everything in between — in the same sentence.',
    story:
      'A fintech serves customers across India who code-switch mid-sentence ("mera balance check karo please"). STT choice, regional deployment and phone-network audio realities dominate the design.',
    requirements: req({
      name: 'India multilingual agent', callsPerDay: 20000, peakConcurrentCalls: 800, latencyTargetMs: 900,
      availabilityTarget: 0.999, languages: ['hi-IN', 'en-IN', 'ta-IN', 'bn-IN'], regions: ['in-mumbai'],
      recording: true, toolUsage: 0.6, budgetPosture: 'low-cost',
    }),
    referencePatternId: 'pat-support',
    crux: [
      'Code-switching STT: the single highest-leverage provider decision in this design',
      'Mumbai region keeps the media round trip domestic',
      'Low-cost posture at 20k calls/day: per-minute meters dominate the budget',
    ],
    learningGoals: ['stt', 'multi-region', 'cost'],
    sampleUtterance: 'Mera account balance check karna hai please',
    tools: ['customer lookup', 'balance API'],
  },
  {
    id: 'sc-premium-latency',
    name: 'Low-latency premium voice assistant',
    tagline: 'It should feel like talking to a sharp human. Budget: whatever it takes.',
    story:
      'A luxury concierge service wants an assistant that answers inside half a second with a beautiful voice. Every hop is on trial; speech-to-speech models enter the conversation.',
    requirements: req({
      name: 'Premium low-latency assistant', channel: 'both', callsPerDay: 2000, peakConcurrentCalls: 100,
      latencyTargetMs: 500, availabilityTarget: 0.999, budgetPosture: 'premium', toolUsage: 0.3,
    }),
    referencePatternId: 'pat-streaming',
    crux: [
      'At a 500 ms target, endpointing alone can eat the budget: semantic turn detection or S2S',
      'S2S vs composed pipeline: latency + prosody vs control + auditability',
      'Regional provider endpoints: 50 ms of network you can delete with a config change',
    ],
    learningGoals: ['s2s', 'latency-perception', 'turn-detection'],
    sampleUtterance: 'Book my usual table for two at eight tonight.',
    tools: ['reservations', 'preferences'],
  },
  {
    id: 'sc-lowcost-volume',
    name: 'Low-cost high-volume voice agent',
    tagline: 'Two hundred thousand reminder calls a day, pennies each.',
    story:
      'A logistics firm confirms deliveries by voice. Calls average 45 seconds, scripts are narrow, volume is enormous. Cost-per-call is the entire architecture brief; every component is chosen by its meter.',
    requirements: req({
      name: 'Low-cost high-volume agent', direction: 'outbound', callsPerDay: 200000, peakConcurrentCalls: 2000,
      avgCallSeconds: 45, latencyTargetMs: 1200, budgetPosture: 'low-cost', toolUsage: 0.4,
    }),
    referencePatternId: 'pat-outbound-scale',
    crux: [
      'Self-hosted TTS/STT crossover math: GPU-hours vs per-minute fees at this volume',
      'Cache the 20 phrases that make up 80% of the audio',
      'Short calls change everything: setup time is now a big fraction of each call',
    ],
    learningGoals: ['cost', 'tts', 'stt'],
    sampleUtterance: 'Yes, tomorrow morning works. Leave it with the neighbour if I am out.',
    tools: ['delivery lookup', 'rescheduling'],
  },
]

export function getScenario(id: string): Scenario | undefined {
  return SCENARIOS.find((s) => s.id === id)
}
