import { useMemo, useState } from 'react'
import { TELEPHONY_PROVIDERS, getTelephony } from '../providers/simulated'
import { Rng } from '../engine/rng'
import { Assumption, Badge, Callout, PageHeader, Panel, Stat, fmtMs } from '../ui/primitives'
import { Segmented, Select } from '../ui/controls'

export default function TelephonyLab() {
  const [providerId, setProviderId] = useState('tel-cpaas')
  const [direction, setDirection] = useState<'inbound' | 'outbound'>('outbound')
  const [seed, setSeed] = useState(1)
  const provider = getTelephony(providerId)

  const call = useMemo(
    () => provider.placeCall({ to: '+91-98xxx', from: '+1-415xxx', direction, region: 'in-mumbai' }, new Rng(`tel-${seed}`)),
    [provider, direction, seed],
  )

  return (
    <div className="p-4">
      <PageHeader
        title="Telephony"
        steps={[
          "Step through the SIP ladder one message at a time.",
          "Notice that signalling and media take different paths — that split explains most telephony surprises.",
          "Flip between inbound and outbound and compare who does the work.",
        ]}
        subtitle="Signalling and media take different paths. That split explains most telephony surprises."
        right={<Assumption>No real telecom connectivity — simulated signalling</Assumption>}
      />

      <div className="grid gap-4 xl:grid-cols-[340px,1fr]">
        <div className="space-y-3">
          <Panel title="Call setup">
            <div className="space-y-3">
              <Select label="Telephony provider (simulated)" value={providerId} onChange={setProviderId}
                options={TELEPHONY_PROVIDERS.map((p) => ({ value: p.id, label: p.name }))} />
              <Segmented value={direction} onChange={setDirection} ariaLabel="Direction"
                options={[
                  { value: 'outbound', label: 'Outbound (we dial)' },
                  { value: 'inbound', label: 'Inbound (they call us)' },
                ]} />
              <button className="btn btn-primary w-full justify-center" onClick={() => setSeed((s) => s + 1)}>
                ☎ Place another call (new seed)
              </button>
            </div>
          </Panel>

          <Panel title={provider.name}>
            <p className="mb-2 text-xs text-ink-400">{provider.profileOf}</p>
            <div className="mb-2 flex flex-wrap gap-1.5">
              <Badge>{provider.style}</Badge>
              <Badge>${provider.cost.usdPerUnit}/min example</Badge>
              <Badge>{provider.channelCapacity.toLocaleString()} channels</Badge>
              {provider.supportsTransfer && <Badge tone="good">transfer</Badge>}
              {provider.supportsDtmf && <Badge tone="good">DTMF</Badge>}
              {provider.supportsRecording && <Badge tone="good">recording</Badge>}
            </div>
            <ul className="ml-4 list-disc space-y-1 text-xs text-ink-400">
              {provider.notes.map((n, i) => <li key={i}>{n}</li>)}
            </ul>
          </Panel>

          <Panel title="Concepts, in one breath each">
            <dl className="space-y-2 text-xs">
              {[
                ['PSTN', 'The global phone network. Reach without installs; 8 kHz audio forever.'],
                ['SIP', 'Text protocol that sets calls up and tears them down. Signalling only.'],
                ['SIP trunking', 'Carrier connectivity as SIP sessions to your SBC — wholesale minutes, your ops.'],
                ['RTP', '20 ms audio packets over UDP. The actual voice. Loss is concealed, never retransmitted.'],
                ['DTMF', 'Touch tones — still the most reliable input on a bad line ("or press 1").'],
                ['Call control', 'Answer, transfer (REFER), hold, conference — verbs of the signalling plane.'],
                ['Recording', 'A media fork at the gateway or provider; async upload, retention policy.'],
                ['Conferencing', 'A mixer bridging N legs — how warm transfer actually works.'],
              ].map(([k, v]) => (
                <div key={k}>
                  <dt className="inline font-semibold text-ink-200">{k}: </dt>
                  <dd className="inline text-ink-400">{v}</dd>
                </div>
              ))}
            </dl>
          </Panel>
        </div>

        <div className="space-y-4">
          <div className="grid gap-2 sm:grid-cols-3">
            <Stat label="Call setup time" value={fmtMs(call.setupMs)} hint="Dial → answered (post-dial delay)." />
            <Stat label="Connected" value={call.connected ? 'yes' : `no (${call.failureReason})`} tone={call.connected ? 'good' : 'bad'}
              hint="Outbound calls fail routinely: busy, no answer, carrier reject. The dialer must have a plan." />
            <Stat label="Media format" value="G.711 mu-law 8 kHz" hint="What the carrier hands you. Non-negotiable on PSTN." />
          </div>

          <Panel title="SIP ladder diagram — click nothing, read everything" right={<Badge tone="control">control plane</Badge>}>
            <div className="relative">
              <div className="mb-2 grid grid-cols-2 text-center text-xs font-semibold text-ink-300">
                <div>Our SBC / provider API</div>
                <div>Carrier / far end</div>
              </div>
              <div className="space-y-0">
                {call.signalling.map((s, i) => (
                  <div key={i} className="group grid grid-cols-[1fr,auto,1fr] items-center gap-2 border-l border-r border-ink-800 px-4 py-2 hover:bg-ink-900">
                    <div className={`text-right font-mono text-xs ${s.direction === 'out' ? 'text-accent' : 'text-ink-600'}`}>
                      {s.direction === 'out' && `${s.message} ⟶`}
                    </div>
                    <div className="w-16 text-center font-mono text-2xs text-ink-500">+{fmtMs(s.atMs)}</div>
                    <div className={`font-mono text-xs ${s.direction === 'in' ? (s.message.startsWith('RTP') ? 'text-media' : 'text-good') : 'text-ink-600'}`}>
                      {s.direction === 'in' && `⟵ ${s.message}`}
                    </div>
                    <div className="col-span-3 hidden pl-2 text-2xs text-ink-500 group-hover:block">{s.note}</div>
                  </div>
                ))}
              </div>
            </div>
            <p className="mt-3 text-xs text-ink-500">Hover a row for what each message means. INVITE and 200 OK carry SDP bodies — the codec/address negotiation that decides whether audio will flow at all.</p>
          </Panel>

          <Callout tone="info" title="SIP = signalling · RTP = media — why the split matters">
            Established calls keep talking when a SIP proxy dies, because audio never touches it. Conversely, “call connected
            but silence” means signalling succeeded and media failed — almost always NAT or firewall asymmetry eating the RTP.
            Two planes, two paths, two failure modes: the same media-plane/control-plane split this whole simulator teaches,
            invented decades before anyone said “control plane”.
          </Callout>

          {!call.connected && (
            <Callout tone="warn" title={`This call did not connect: ${call.failureReason}`}>
              At scale this is not an error, it is a rate: answer rates of 20–40% are normal for outbound campaigns (assumption).
              The dialer must decide per outcome: retry later (no-answer), voicemail drop (machine), remove from list (invalid),
              back off (carrier reject — you may be getting spam-labelled).
            </Callout>
          )}
        </div>
      </div>
    </div>
  )
}
