/**
 * Security and compliance awareness for voice systems.
 *
 * Voice is unusually exposed, for reasons that are specific to the medium:
 *
 *  - The raw input is biometric. A voice recording identifies a person whether
 *    or not you intended to collect an identifier.
 *  - Callers say card numbers out loud. There is no "password field" on a
 *    phone call, so the sensitive data arrives in the same channel as
 *    everything else and is captured by the same recorder.
 *  - Every transcript is a copy, every log line is another copy, and the
 *    speech vendor has one too. A voice pipeline produces more copies of
 *    sensitive data than almost any other kind of system.
 *  - Deletion means deleting audio, transcript, derived analytics, vendor-side
 *    copies and backups. Most teams can delete the first two.
 *
 * This model is an *awareness* tool, not legal advice, and the app says so
 * everywhere it appears. What it checks is whether the architecture has
 * somewhere to put each obligation — not whether any particular deployment
 * satisfies a regulation, which no simulator can know.
 */

import type { Architecture, Requirements } from '../domain/types'
import { getSpec } from '../registry/components'

export interface Regime {
  id: string
  name: string
  appliesWhen: string
  /** The obligations this model can actually check for. */
  demands: string[]
  /** The voice-specific trap people fall into under this regime. */
  voiceTrap: string
}

export const REGIMES: Regime[] = [
  {
    id: 'pci',
    name: 'PCI-DSS',
    appliesWhen: 'Card numbers are spoken, entered or stored anywhere in the call path.',
    demands: [
      'Card data must not be written to recordings, transcripts or logs.',
      'The systems that touch card data are in scope for audit — and so is everything connected to them.',
      'Access to anything carrying card data is logged and restricted.',
    ],
    voiceTrap:
      'Pause-and-resume recording is the usual answer, and it fails in the usual way: the caller reads the number before the agent finishes saying "let me pause the recording". The safe design never routes card audio through your systems at all — DTMF capture with digit suppression, or a transfer to a payment IVR.',
  },
  {
    id: 'gdpr',
    name: 'GDPR',
    appliesWhen: 'Any caller is in the EU, regardless of where your servers are.',
    demands: [
      'A lawful basis for recording, and a way to record consent to it.',
      'Erasure on request, across every copy including derived data and backups.',
      'A record of which processors receive the data — every speech vendor is one.',
      'Data minimisation: collecting a full recording because it is easy is not a basis.',
    ],
    voiceTrap:
      'Voice is biometric data, which sits in the special category. "We only keep transcripts" does not help if the transcript names a health condition, and an erasure request has to reach the speech vendor\'s retention too — which means you needed that in the contract before the request arrived.',
  },
  {
    id: 'dpdp',
    name: 'India DPDP Act',
    appliesWhen: 'Callers are in India.',
    demands: [
      'Notice and consent for the purpose the data is collected for.',
      'Erasure on withdrawal of consent.',
      'Breach notification obligations.',
    ],
    voiceTrap:
      'Consent on a phone call is spoken, which means the record of consent is itself a recording — and that recording is subject to the same obligations as everything else. Design where the consent artefact lives before you design the call flow.',
  },
  {
    id: 'hipaa',
    name: 'HIPAA',
    appliesWhen: 'The call can touch health information, including an appointment reason.',
    demands: [
      'Business associate agreements with every vendor that processes the audio.',
      'Encryption in transit and at rest.',
      'Audit trails on access to recordings and transcripts.',
      'Minimum necessary: the agent should not collect what it does not need.',
    ],
    voiceTrap:
      'The scope is wider than people expect. "I am calling about my test results" is health information, and it is in the first utterance, before any consent flow or any routing decision has run.',
  },
  {
    id: 'soc2',
    name: 'SOC 2',
    appliesWhen: 'Enterprise customers ask for it, which they will.',
    demands: [
      'Access control and audit logging on production data.',
      'Change management and monitoring.',
      'Documented incident response.',
    ],
    voiceTrap:
      'The control that fails an audit is usually the boring one: engineers listening to production recordings to debug, with no access log and no ticket. Build the listening tool with the audit trail in it, before anyone needs to listen.',
  },
]

export type Sensitivity = 'low' | 'medium' | 'high' | 'critical'

export interface DataArtefact {
  id: string
  name: string
  sensitivity: Sensitivity
  whereItLives: string
  /** Why this one is easy to forget. */
  easilyMissed: string
}

/**
 * Every copy of caller data a voice pipeline creates.
 *
 * The list is the lesson: most teams protect the first two and forget the rest,
 * and an erasure request has to reach all of them.
 */
export const DATA_ARTEFACTS: DataArtefact[] = [
  {
    id: 'raw-audio',
    name: 'Raw call audio',
    sensitivity: 'critical',
    whereItLives: 'Media gateway memory, and the recorder if recording is on.',
    easilyMissed: 'It is biometric whether or not anyone said anything sensitive. Voice identifies a person by itself.',
  },
  {
    id: 'recording',
    name: 'Stored recording',
    sensitivity: 'critical',
    whereItLives: 'Object storage, plus every backup of it.',
    easilyMissed: 'Lifecycle policies delete the live object and leave the backups, which is the copy an auditor asks about.',
  },
  {
    id: 'transcript',
    name: 'Transcript',
    sensitivity: 'high',
    whereItLives: 'The database, the analytics pipeline, and the speech vendor.',
    easilyMissed: 'The vendor\'s copy is the one you do not control and the one you must still be able to delete.',
  },
  {
    id: 'llm-context',
    name: 'Prompt context sent to the model',
    sensitivity: 'high',
    whereItLives: 'The model provider, plus any request logging on your side.',
    easilyMissed:
      'Debug logging of the full prompt is the most common accidental PII leak in an AI system, and it is usually added during an incident by someone who means well.',
  },
  {
    id: 'tool-args',
    name: 'Tool call arguments and results',
    sensitivity: 'high',
    whereItLives: 'Application logs, traces, and the backend systems called.',
    easilyMissed: 'Tracing captures arguments by default. An order lookup trace contains the customer identifier, forever.',
  },
  {
    id: 'derived',
    name: 'Derived analytics',
    sensitivity: 'medium',
    whereItLives: 'The event log, the warehouse, and every dashboard built on it.',
    easilyMissed: 'Aggregates feel anonymous and frequently are not — a sentiment score keyed by phone number is personal data.',
  },
  {
    id: 'telemetry',
    name: 'Telemetry and error reports',
    sensitivity: 'medium',
    whereItLives: 'The observability vendor.',
    easilyMissed: 'An exception message often carries the payload that caused it, and that payload is a caller\'s sentence.',
  },
]

export interface ComplianceFinding {
  severity: 'error' | 'warning' | 'info'
  title: string
  detail: string
  fix: string
  regimes: string[]
  targets: string[]
}

export interface ComplianceReport {
  findings: ComplianceFinding[]
  applicable: Regime[]
  /** Artefacts this architecture actually produces. */
  artefacts: DataArtefact[]
  /** Blunt statement of what this check is and is not. */
  disclaimer: string
}

const DISCLAIMER =
  'This is an awareness check inside a simulator, not legal or compliance advice. It looks for whether the architecture has somewhere to put an obligation — a retention policy, a redaction point, a residency boundary. Whether a real deployment satisfies a real regulation is a question for people who do that professionally.'

export function checkCompliance(arch: Architecture, req?: Requirements): ComplianceReport {
  const findings: ComplianceFinding[] = []
  const named = new Set((req?.compliance ?? []).map((c) => c.toLowerCase()))
  const applicable = REGIMES.filter(
    (r) => named.has(r.id) || named.has(r.name.toLowerCase()) || [...named].some((n) => r.name.toLowerCase().includes(n)),
  )

  const has = (specId: string) => arch.nodes.some((n) => n.specId === specId)
  const nodesOf = (specId: string) => arch.nodes.filter((n) => n.specId === specId).map((n) => n.id)

  const recording = req?.recording ?? has('object-storage')

  if (recording && !has('object-storage')) {
    findings.push({
      severity: 'error',
      title: 'Recording is required but there is nowhere to put the recordings',
      detail:
        'The requirements ask for recording and the architecture has no storage component. Recordings that exist only on a media server disappear with the instance, which is a data-loss problem and an evidence problem at the same time.',
      fix: 'Add object storage, and decide the retention period at the same time. A bucket without a lifecycle policy is a compliance liability that grows every month.',
      regimes: ['gdpr', 'dpdp', 'hipaa'],
      targets: [],
    })
  }

  if (recording && has('object-storage')) {
    findings.push({
      severity: 'warning',
      title: 'Recordings exist: retention and erasure have to be designed, not assumed',
      detail:
        'Every recording is biometric data with a lifespan. An erasure request has to reach the object, its backups, the transcript derived from it, the analytics derived from that, and the speech vendor\'s copy.',
      fix: 'Set a lifecycle policy with an explicit retention period, and write down — per artefact — how erasure reaches it. The list is longer than most teams expect; that is the point of writing it.',
      regimes: ['gdpr', 'dpdp', 'hipaa'],
      targets: nodesOf('object-storage'),
    })
  }

  // Payment data.
  if (applicable.some((r) => r.id === 'pci')) {
    findings.push({
      severity: recording ? 'error' : 'warning',
      title: recording
        ? 'Card data is in scope and recording is on'
        : 'Card data is in scope',
      detail: recording
        ? 'With PCI in scope and recording enabled, spoken card numbers land in the recording, the transcript, the speech vendor and the analytics pipeline. Pause-and-resume depends on the agent reacting before the caller speaks, which is not a control you can evidence.'
        : 'Card data spoken on a call passes through recognition and the model before anything can redact it. Whatever you do afterwards, the vendor has already seen it.',
      fix: 'Keep card audio out of your systems entirely: DTMF capture with digit suppression, or transfer to a dedicated payment IVR and back. This is the one case where the right architecture is "do not receive the data".',
      regimes: ['pci'],
      targets: nodesOf('stt').concat(nodesOf('object-storage')),
    })
  }

  // Residency.
  if (req && req.regions.length > 1) {
    findings.push({
      severity: 'warning',
      title: `Data crosses ${req.regions.length} regions`,
      detail:
        'Multi-region deployment turns "where does this live" into a per-artefact decision. Recordings are usually the strictest and the largest; analytics are the easiest to forget because nobody thinks of an aggregate as personal data.',
      fix: 'Write down, for each of the artefacts listed in this report, which region is authoritative and which copies may exist elsewhere. Then check that the answer survives a regional failover.',
      regimes: ['gdpr', 'dpdp'],
      targets: nodesOf('object-storage').concat(nodesOf('postgres')),
    })
  }

  // Observability as a leak path.
  if (has('monitoring')) {
    findings.push({
      severity: 'info',
      title: 'Telemetry is a copy of caller data',
      detail:
        'Traces capture tool arguments, error reports capture the payload that caused them, and debug logging of prompts captures everything the caller said. All three are exports to a third party, and none of them look like data handling when they are added.',
      fix: 'Redact at the emit point, not at the dashboard. Treat the observability vendor as a processor in your data map, and forbid full-prompt logging in production — including temporarily, during an incident, when it is most tempting.',
      regimes: ['gdpr', 'soc2', 'hipaa'],
      targets: nodesOf('monitoring'),
    })
  }

  // Human agents see everything.
  if (has('human-agent')) {
    findings.push({
      severity: 'info',
      title: 'Human agents are an access-control surface',
      detail:
        'A transferred call gives a person live access to whatever the agent has gathered, and usually to the caller record behind it. Screen-pop context is a genuine productivity win and a genuine exposure.',
      fix: 'Scope what appears on transfer to what the task needs, and log access to recordings and transcripts. The audit finding is almost never the transfer itself — it is an engineer listening to recordings with no ticket and no log.',
      regimes: ['soc2', 'hipaa'],
      targets: nodesOf('human-agent'),
    })
  }

  // Vendors as processors.
  const vendors = ['stt', 'tts', 'llm', 's2s'].filter(has)
  if (vendors.length > 0) {
    findings.push({
      severity: 'info',
      title: `${vendors.length} external processor${vendors.length > 1 ? 's' : ''} receive caller speech`,
      detail:
        'Every speech and model vendor on the path is a data processor. They have their own retention, their own regions, and — unless you have configured otherwise — potentially their own training use.',
      fix: 'Name each one in your data map with its retention and region. Turn off training use explicitly rather than assuming the default, and check that an erasure request can actually reach them.',
      regimes: ['gdpr', 'dpdp', 'hipaa', 'soc2'],
      targets: vendors.flatMap(nodesOf),
    })
  }

  // Encryption on the media plane.
  const unencryptedMedia = arch.edges.filter((e) => e.plane === 'media' && (e.protocol === 'RTP' || e.protocol === 'PSTN'))
  if (unencryptedMedia.length > 0) {
    findings.push({
      severity: 'warning',
      title: 'Media travels unencrypted on part of the path',
      detail: `${unencryptedMedia.length} media edge${
        unencryptedMedia.length > 1 ? 's use' : ' uses'
      } plain RTP or the PSTN. On the public network that is readable; inside a carrier network it is a contractual rather than a technical protection.`,
      fix: 'Use SRTP wherever both ends are yours. Where the PSTN leg is unavoidable, say so explicitly in the data map rather than leaving it implied — an unstated exception is the one that surprises an auditor.',
      regimes: ['hipaa', 'pci', 'soc2'],
      targets: unencryptedMedia.map((e) => e.id),
    })
  }

  const artefacts = DATA_ARTEFACTS.filter((a) => {
    if (a.id === 'recording') return recording
    if (a.id === 'telemetry') return has('monitoring')
    if (a.id === 'derived') return has('kafka') || has('queue')
    if (a.id === 'llm-context') return has('llm') || has('s2s')
    if (a.id === 'tool-args') return has('tool-api')
    return true
  })

  return { findings, applicable, artefacts, disclaimer: DISCLAIMER }
}

/** Components that carry sensitive data, for canvas highlighting. */
export function sensitiveNodes(arch: Architecture): string[] {
  return arch.nodes
    .filter((n) => {
      const spec = getSpec(n.specId)
      return (
        spec.onMediaPath ||
        ['object-storage', 'postgres', 'monitoring', 'kafka', 'human-agent'].includes(n.specId)
      )
    })
    .map((n) => n.id)
}
