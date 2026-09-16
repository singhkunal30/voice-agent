/**
 * The state machines that govern a voice agent, as inspectable data.
 *
 * Three machines: conversation (the agent's turn lifecycle), telephony (the
 * call leg lifecycle) and handoff (AI → human transfer). The State Machine Lab
 * renders these and lets the learner fire events against them; the call
 * simulator's NOTE events reference the same state names, so the two views
 * reinforce each other.
 */

import type { StateMachineDef } from '../domain/types'

export const CONVERSATION_SM: StateMachineDef = {
  id: 'conversation',
  name: 'Conversation state machine',
  description:
    'The per-call brain of the agent runtime. Every event in the pipeline (VAD, STT, LLM, TTS) lands here, and the current state decides what it means: the same SPEECH_STARTED event is "user begins turn" in LISTENING but "barge-in!" in SPEAKING.',
  initial: 'IDLE',
  states: [
    {
      id: 'IDLE', name: 'IDLE',
      description: 'Call connected, session initialised, nothing in flight. Usually lasts milliseconds before the greeting.',
      onEntry: ['Create session record (Redis)', 'Start call timers and metrics'],
      onExit: ['Log transition with cause'],
      timers: [{ name: 'greeting_delay', ms: 300, onExpiry: 'Queue greeting through TTS' }],
      failures: ['Session store unavailable → continue with in-memory state, flag degraded'],
      cleanup: ['None — nothing owned yet'],
    },
    {
      id: 'LISTENING', name: 'LISTENING',
      description: 'Microphone open, STT streaming, VAD watching. The agent is silent and attentive.',
      onEntry: ['Ensure STT stream open', 'Reset endpointing timers'],
      onExit: ['Snapshot interim transcript'],
      timers: [
        { name: 'no_input', ms: 8000, onExpiry: 'Re-prompt: “Are you still there?”' },
        { name: 'silence_endpoint', ms: 600, onExpiry: 'Declare TURN_COMPLETE (starts on SPEECH_ENDED)' },
      ],
      failures: ['STT stream drops → reconnect with audio replay buffer; fallback provider after N failures'],
      cleanup: ['Cancel no-input timer'],
    },
    {
      id: 'PROCESSING', name: 'PROCESSING',
      description: 'Turn committed: context built, LLM (and possibly tools) working. The caller hears silence — this state has a hard latency budget.',
      onEntry: ['Build prompt from state + transcript', 'Start LLM with timeout', 'Arm filler timer'],
      onExit: ['Persist turn to session state'],
      timers: [
        { name: 'filler', ms: 900, onExpiry: 'Speak filler (“Let me check that…”) — dead air over ~1 s reads as broken' },
        { name: 'llm_budget', ms: 4000, onExpiry: 'Abort → retry once → apologise or escalate' },
      ],
      failures: ['LLM timeout/error → retry then fallback', 'Tool failure → spoken degradation path', 'Malformed tool args → re-prompt model once'],
      cleanup: ['Cancel in-flight LLM/tool calls if the user speaks again (their new turn wins)'],
    },
    {
      id: 'SPEAKING', name: 'SPEAKING',
      description: 'TTS audio streaming to the caller. VAD still runs — the user can interrupt at any instant, and must be able to.',
      onEntry: ['Start TTS stream', 'Keep VAD active (barge-in armed)'],
      onExit: ['Record how much of the reply was actually heard'],
      timers: [{ name: 'tts_stall', ms: 2500, onExpiry: 'TTS underrun → fallback voice or apologise' }],
      failures: ['TTS stall mid-utterance → fallback voice finishes the sentence', 'Transport backpressure → drop oldest audio, never grow unbounded'],
      cleanup: ['On exit for ANY reason: cancel TTS upstream AND flush transport audio buffer'],
    },
    {
      id: 'INTERRUPTED', name: 'INTERRUPTED',
      description: 'Barge-in confirmed while speaking. A transient state whose whole job is cleanup-then-listen, fast.',
      onEntry: ['CANCEL_TTS upstream', 'CLEAR_AUDIO_BUFFER at transport', 'Mark reply as partially-delivered in history'],
      onExit: ['Transition to LISTENING within ~100 ms'],
      timers: [],
      failures: ['Buffer not cleared → agent “talks over” the user for seconds — the classic barge-in bug'],
      cleanup: ['Everything queued for playback is discarded'],
    },
    {
      id: 'ENDED', name: 'ENDED',
      description: 'Terminal. Persist, enqueue async jobs, release resources.',
      onEntry: ['Persist transcript + outcome (async)', 'Enqueue recording upload + CRM update', 'Close provider streams', 'Delete session key after grace period'],
      onExit: [],
      timers: [],
      failures: ['Async job enqueue fails → durable local spool, retry — never lose the record of a call'],
      cleanup: ['All timers cancelled, all sockets closed, memory released'],
    },
  ],
  transitions: [
    { from: 'IDLE', to: 'SPEAKING', event: 'GREETING_READY', action: 'Stream greeting audio' },
    { from: 'IDLE', to: 'LISTENING', event: 'SPEECH_STARTED', guard: 'user speaks before greeting', action: 'Skip greeting' },
    { from: 'LISTENING', to: 'PROCESSING', event: 'TURN_COMPLETE', guard: 'endpoint AND final transcript', action: 'Build context, call LLM' },
    { from: 'PROCESSING', to: 'SPEAKING', event: 'FIRST_SENTENCE_READY', action: 'Start TTS stream' },
    { from: 'PROCESSING', to: 'LISTENING', event: 'SPEECH_STARTED', guard: 'user adds more before reply', action: 'Cancel LLM, merge turns' },
    { from: 'SPEAKING', to: 'INTERRUPTED', event: 'SPEECH_STARTED', guard: 'sustained past min-duration gate', action: 'Confirm barge-in' },
    { from: 'SPEAKING', to: 'LISTENING', event: 'PLAYBACK_COMPLETED', action: 'Reply fully delivered' },
    { from: 'INTERRUPTED', to: 'LISTENING', event: 'BUFFER_CLEARED', action: 'New user turn begins' },
    { from: 'LISTENING', to: 'ENDED', event: 'CALL_ENDED' },
    { from: 'PROCESSING', to: 'ENDED', event: 'CALL_ENDED', action: 'Cancel in-flight work; handle orphaned tool results' },
    { from: 'SPEAKING', to: 'ENDED', event: 'CALL_ENDED', action: 'Cancel TTS' },
    { from: 'IDLE', to: 'ENDED', event: 'CALL_ENDED' },
    { from: 'INTERRUPTED', to: 'ENDED', event: 'CALL_ENDED' },
  ],
}

export const TELEPHONY_SM: StateMachineDef = {
  id: 'telephony',
  name: 'Telephony call state machine',
  description:
    'The call leg as the carrier sees it. Runs in parallel with the conversation machine — a call can be CONNECTED while the conversation is in any of its states. Handoff lives here because transfer is a media-plane operation.',
  initial: 'RINGING',
  states: [
    {
      id: 'RINGING', name: 'RINGING',
      description: 'INVITE received (inbound) or sent (outbound); no media yet. Early media (ringback) may flow.',
      onEntry: ['Validate webhook signature', 'Rate-limit check', 'Allocate call record'],
      onExit: [],
      timers: [{ name: 'answer_timeout', ms: 30000, onExpiry: 'Outbound: mark no-answer, schedule retry or voicemail' }],
      failures: ['Carrier rejects (486/503) → dial-strategy decides: retry, alternate route, give up'],
      cleanup: ['Release reserved channel on abandonment'],
    },
    {
      id: 'CONNECTED', name: 'CONNECTED',
      description: 'Answered; RTP/media stream established. Conversation machine starts at IDLE.',
      onEntry: ['Open media stream (WS/RTP)', 'Start billing meter', 'Start recording fork if enabled'],
      onExit: [],
      timers: [{ name: 'max_duration', ms: 3600000, onExpiry: 'Hard cap — bill-shock protection' }],
      failures: ['Media never arrives despite 200 OK → one-way-audio detection, teardown + alert (NAT asymmetry)'],
      cleanup: [],
    },
    {
      id: 'AI_ACTIVE', name: 'AI_ACTIVE',
      description: 'Media is anchored to the AI pipeline; the conversation machine drives.',
      onEntry: ['Bind call to a media-gateway instance (sticky)'],
      onExit: [],
      timers: [],
      failures: ['Gateway instance dies → carrier-level redirect to healthy instance, session restored from Redis'],
      cleanup: [],
    },
    {
      id: 'TRANSFERRING', name: 'TRANSFERRING',
      description: 'Handoff in progress: availability check, queueing, media re-anchor, context transfer. Has more failure branches than any other state.',
      onEntry: ['CHECK_AGENT_AVAILABILITY', 'Whisper-announce to human', 'Prepare context packet (transcript, slots, CRM)'],
      onExit: [],
      timers: [
        { name: 'accept_timeout', ms: 20000, onExpiry: 'Agent did not accept → next agent or queue' },
        { name: 'queue_max_wait', ms: 120000, onExpiry: 'Fallback: callback offer / voicemail' },
      ],
      failures: ['No agents → queue with honest ETA', 'Transfer leg fails → AI resumes and apologises', 'Context transfer fails → human still connected, but flying blind (alert!)'],
      cleanup: ['On failure: tear down the half-built human leg'],
    },
    {
      id: 'HUMAN_ACTIVE', name: 'HUMAN_ACTIVE',
      description: 'Human owns the call. AI media legs are gone; optional AI-assist (live suggestions) may continue on a listen-only tap.',
      onEntry: ['AI_LEAVES: tear down AI legs', 'Switch billing meters', 'Human desktop owns disposition'],
      onExit: [],
      timers: [],
      failures: ['Human drops → re-queue caller or return to AI, never dead air'],
      cleanup: [],
    },
    {
      id: 'ENDED', name: 'ENDED',
      description: 'BYE processed; media closed; post-call jobs enqueued.',
      onEntry: ['Stop billing', 'Finalize recording upload (async)', 'Emit CDR event'],
      onExit: [],
      timers: [],
      failures: [],
      cleanup: ['All legs down, channel released'],
    },
  ],
  transitions: [
    { from: 'RINGING', to: 'CONNECTED', event: 'ANSWERED (200 OK + ACK)' },
    { from: 'RINGING', to: 'ENDED', event: 'NO_ANSWER / REJECTED / CANCELLED' },
    { from: 'CONNECTED', to: 'AI_ACTIVE', event: 'MEDIA_STREAM_READY' },
    { from: 'AI_ACTIVE', to: 'TRANSFERRING', event: 'HANDOFF_REQUESTED' },
    { from: 'TRANSFERRING', to: 'HUMAN_ACTIVE', event: 'HANDOFF_COMPLETED' },
    { from: 'TRANSFERRING', to: 'AI_ACTIVE', event: 'HANDOFF_FAILED', action: 'AI resumes with apology + fallback offer' },
    { from: 'AI_ACTIVE', to: 'ENDED', event: 'BYE / HANGUP' },
    { from: 'HUMAN_ACTIVE', to: 'ENDED', event: 'BYE / HANGUP' },
    { from: 'CONNECTED', to: 'ENDED', event: 'BYE / HANGUP' },
    { from: 'TRANSFERRING', to: 'ENDED', event: 'CALLER_ABANDONS', action: 'Log abandonment at queue position N' },
  ],
}

export const HANDOFF_SM: StateMachineDef = {
  id: 'handoff',
  name: 'Human handoff sequence',
  description:
    'The transfer, zoomed in. Handoff is a distributed transaction across three planes: routing (find a human), media (move the audio) and context (move the conversation). Each step can fail independently and each failure needs a caller-audible recovery.',
  initial: 'TRANSFER_REQUESTED',
  states: [
    {
      id: 'TRANSFER_REQUESTED', name: 'TRANSFER_REQUESTED',
      description: 'AI (policy or user request) decided a human is needed. The AI keeps talking — “let me connect you” — while routing works.',
      onEntry: ['Freeze new tool calls', 'Snapshot conversation state for the context packet'],
      onExit: [],
      timers: [],
      failures: [],
      cleanup: [],
    },
    {
      id: 'CHECK_AVAILABILITY', name: 'CHECK_AGENT_AVAILABILITY',
      description: 'Query the presence/queue system for a matching skill group (language, product line, licence).',
      onEntry: ['Skill-based routing query'],
      onExit: [],
      timers: [{ name: 'routing_budget', ms: 3000, onExpiry: 'Assume no agents; go to queue/fallback' }],
      failures: ['Presence system down → treat as no-agents, use fallback path'],
      cleanup: [],
    },
    {
      id: 'QUEUED', name: 'QUEUED',
      description: 'All matching agents busy. The AI holds the caller honestly: position, ETA, and an escape hatch (callback).',
      onEntry: ['Announce honest wait estimate', 'Offer callback alternative'],
      onExit: [],
      timers: [{ name: 'max_wait', ms: 120000, onExpiry: 'Fallback: callback booking or voicemail' }],
      failures: ['Caller abandons → log abandonment with queue stats'],
      cleanup: ['Remove from queue on exit'],
    },
    {
      id: 'HUMAN_ACCEPTED', name: 'HUMAN_ACCEPTED',
      description: 'An agent clicked accept. Their desktop shows the screen-pop: live transcript, intent, collected slots, CRM record.',
      onEntry: ['Reserve the agent (no double-assignment)', 'Push context packet to desktop'],
      onExit: [],
      timers: [{ name: 'bridge_budget', ms: 8000, onExpiry: 'Bridge failed → release agent, retry or fallback' }],
      failures: ['Agent desktop audio fails → auto-release and route to next agent'],
      cleanup: ['Release reservation on failure'],
    },
    {
      id: 'MEDIA_HANDOFF', name: 'MEDIA_HANDOFF',
      description: 'The audio moves: conference-bridge join (safe, allows whisper + warm intro) or SIP REFER (clean, removes the middle leg).',
      onEntry: ['Join human leg to bridge', 'Optional whisper: AI summarises to human before joining caller'],
      onExit: [],
      timers: [],
      failures: ['REFER rejected by far end → fall back to bridge mode'],
      cleanup: [],
    },
    {
      id: 'CONTEXT_TRANSFER', name: 'CONTEXT_TRANSFER',
      description: 'The conversation moves: transcript, slots, tool results, sentiment. Without this the caller repeats everything — the #1 handoff complaint.',
      onEntry: ['Attach transcript + structured slots to the interaction record'],
      onExit: [],
      timers: [],
      failures: ['Transfer of context fails → human proceeds blind; alert raised; AI summary retried in background'],
      cleanup: [],
    },
    {
      id: 'AI_LEAVES', name: 'AI_LEAVES',
      description: 'AI legs torn down; meters switch; the AI stops billing and stops listening (unless a listen-only assist tap is configured — a privacy decision to make explicitly).',
      onEntry: ['Tear down STT/LLM/TTS sessions', 'Switch billing', 'Mark session human-active'],
      onExit: [],
      timers: [],
      failures: [],
      cleanup: ['All AI provider streams closed — leaks here cost real money'],
    },
    {
      id: 'HUMAN_CONTINUES', name: 'HUMAN_CONTINUES',
      description: 'Terminal for the AI. The human finishes the job.',
      onEntry: [],
      onExit: [],
      timers: [],
      failures: [],
      cleanup: [],
    },
  ],
  transitions: [
    { from: 'TRANSFER_REQUESTED', to: 'CHECK_AVAILABILITY', event: 'ROUTING_STARTED' },
    { from: 'CHECK_AVAILABILITY', to: 'HUMAN_ACCEPTED', event: 'AGENT_FOUND' },
    { from: 'CHECK_AVAILABILITY', to: 'QUEUED', event: 'ALL_AGENTS_BUSY' },
    { from: 'QUEUED', to: 'HUMAN_ACCEPTED', event: 'AGENT_FREED' },
    { from: 'QUEUED', to: 'HUMAN_CONTINUES', event: 'MAX_WAIT_EXCEEDED', guard: 'fallback = callback/voicemail', action: 'AI books callback; call ends politely' },
    { from: 'HUMAN_ACCEPTED', to: 'MEDIA_HANDOFF', event: 'DESKTOP_READY' },
    { from: 'MEDIA_HANDOFF', to: 'CONTEXT_TRANSFER', event: 'BRIDGE_ESTABLISHED' },
    { from: 'CONTEXT_TRANSFER', to: 'AI_LEAVES', event: 'CONTEXT_DELIVERED' },
    { from: 'AI_LEAVES', to: 'HUMAN_CONTINUES', event: 'TEARDOWN_COMPLETE' },
    { from: 'MEDIA_HANDOFF', to: 'CHECK_AVAILABILITY', event: 'BRIDGE_FAILED', action: 'Release agent; try next' },
  ],
}

export const STATE_MACHINES = [CONVERSATION_SM, TELEPHONY_SM, HANDOFF_SM]
