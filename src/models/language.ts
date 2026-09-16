/**
 * Language, accent and code-switching.
 *
 * Almost every voice-agent tutorial is monolingual English on clean audio, and
 * almost every real deployment is neither. This model exists to make the gap
 * visible: what happens to recognition when the caller is on a phone, speaks
 * with an accent the model saw little of, and switches language mid-sentence
 * because that is simply how they talk.
 *
 * Hinglish is the worked example because it is the honest hard case. "मेरा
 * order कहाँ है" is one sentence in one person's head. It is two languages,
 * two scripts and one intent, and a per-call language setting gets it wrong in
 * both directions.
 *
 * EVERY NUMBER HERE IS AN ASSUMPTION. Error rates depend on the vendor, the
 * model version, the speaker, the microphone and the topic. What is being
 * taught is the *shape*: which factors compound, which are additive, and which
 * design responses actually help.
 */

import { Rng } from '../engine/rng'
import { round } from '../engine/simulation'

export interface LanguageProfile {
  id: string
  name: string
  /** How a speaker would name it. */
  nativeName: string
  script: string
  /**
   * Word error rate for a good streaming recogniser on clean 16 kHz audio,
   * general domain. ASSUMPTION.
   */
  baseWer: number
  /** Extra WER when the same audio arrives as 8 kHz telephony. ASSUMPTION. */
  telephonyPenalty: number
  /** How much synthesis in this language sounds like a person. 0..1 ASSUMPTION. */
  ttsNaturalness: number
  /** Things that go wrong specifically in this language. */
  hazards: string[]
}

export const LANGUAGES: LanguageProfile[] = [
  {
    id: 'en-US',
    name: 'English (US)',
    nativeName: 'English',
    script: 'Latin',
    baseWer: 0.05,
    telephonyPenalty: 0.03,
    ttsNaturalness: 0.92,
    hazards: [
      'Homophone pairs that matter commercially: "to/two/too", "for/four".',
      'Spelled-out names collapse on 8 kHz audio — S/F and M/N are the classic confusions.',
    ],
  },
  {
    id: 'en-IN',
    name: 'English (Indian)',
    nativeName: 'English',
    script: 'Latin',
    baseWer: 0.08,
    telephonyPenalty: 0.04,
    ttsNaturalness: 0.85,
    hazards: [
      'Models trained mostly on US/UK speech degrade measurably here, and the degradation is uneven: numbers and proper nouns suffer most.',
      'Indian English number conventions — "lakh", "crore", "double five" — are routinely mis-transcribed as words rather than quantities.',
    ],
  },
  {
    id: 'hi-IN',
    name: 'Hindi',
    nativeName: 'हिन्दी',
    script: 'Devanagari',
    baseWer: 0.12,
    telephonyPenalty: 0.05,
    ttsNaturalness: 0.82,
    hazards: [
      'Less training data than English, so the error rate starts higher before any channel penalty.',
      'Transliteration is not standardised: the same spoken word arrives as Devanagari or Latin depending on the model, and downstream string matching breaks.',
    ],
  },
  {
    id: 'hi-Latn',
    name: 'Hinglish (code-switched)',
    nativeName: 'हिंग्लिश',
    script: 'Mixed',
    baseWer: 0.18,
    telephonyPenalty: 0.06,
    ttsNaturalness: 0.7,
    hazards: [
      'Not a language setting. A monolingual Hindi model mangles the English words; a monolingual English model mangles the Hindi ones. Both are confidently wrong.',
      'Switch points are mid-sentence and unpredictable, so per-utterance language detection has no clean boundary to fire on.',
      'Synthesis is worse than recognition here: a Hindi voice reading English words, or an English voice reading Devanagari, is immediately and obviously wrong to the caller.',
    ],
  },
]

export function getLanguage(id: string): LanguageProfile {
  return LANGUAGES.find((l) => l.id === id) ?? LANGUAGES[0]
}

// ---------------------------------------------------------------------------
// Recognition quality
// ---------------------------------------------------------------------------

export interface RecognitionInputs {
  languageId: string
  /** Telephony (8 kHz) or wideband (16 kHz+). */
  channel: 'phone' | 'browser'
  /** 0 = silent room, 1 = roadside. */
  noiseLevel: number
  /** True when the pipeline routes per-utterance rather than per-call. */
  perUtteranceRouting: boolean
  /** True when the recogniser was trained on the code-switched variety itself. */
  codeSwitchAware: boolean
  /** Share of utterances that actually mix languages, 0..1. */
  codeSwitchRate: number
  /** Domain vocabulary supplied to the recogniser (product names, cities). */
  customVocabulary: boolean
}

export const DEFAULT_RECOGNITION: RecognitionInputs = {
  languageId: 'en-IN',
  channel: 'phone',
  noiseLevel: 0.15,
  perUtteranceRouting: false,
  codeSwitchAware: false,
  codeSwitchRate: 0.35,
  customVocabulary: false,
}

export interface RecognitionQuality {
  /** Effective word error rate across the whole call. */
  wer: number
  /** WER on the utterances that stayed in one language. */
  monolingualWer: number
  /** WER on the utterances that mixed languages. */
  codeSwitchedWer: number
  /** Contributions, largest first — this is what the lab renders. */
  contributions: { label: string; deltaWer: number; note: string }[]
  /** Things this configuration will get wrong in a way the caller notices. */
  hazards: string[]
}

export function recognitionQuality(i: RecognitionInputs): RecognitionQuality {
  const lang = getLanguage(i.languageId)
  const contributions: { label: string; deltaWer: number; note: string }[] = []

  let wer = lang.baseWer
  contributions.push({
    label: `${lang.name} baseline`,
    deltaWer: lang.baseWer,
    note: 'Clean wideband audio, general vocabulary, a good streaming recogniser. The floor everything else is added to.',
  })

  if (i.channel === 'phone') {
    wer += lang.telephonyPenalty
    contributions.push({
      label: 'Telephony audio (8 kHz)',
      deltaWer: lang.telephonyPenalty,
      note: 'Everything above 4 kHz is gone before recognition starts — the Nyquist limit of an 8 kHz sample rate. Fricatives and spelled letters are the first casualties, which is why callers spell their names three times.',
    })
  }

  const noisePenalty = round(i.noiseLevel * 0.12, 4)
  if (noisePenalty > 0) {
    wer += noisePenalty
    contributions.push({
      label: 'Background noise',
      deltaWer: noisePenalty,
      note: 'Noise costs accuracy twice: the recogniser mishears words, and the VAD hears speech that was never there, cutting turns short.',
    })
  }

  if (i.customVocabulary) {
    const gain = 0.02
    wer -= gain
    contributions.push({
      label: 'Custom vocabulary supplied',
      deltaWer: -gain,
      note: 'Biasing the recogniser toward your product names, cities and plan tiers is the cheapest accuracy win available, and it only helps on the words that actually matter to the outcome.',
    })
  }

  const monolingualWer = Math.max(0.01, round(wer, 4))

  // Code-switched utterances are a separate population with their own error rate.
  let csWer = monolingualWer
  if (i.codeSwitchAware) {
    csWer += 0.04
  } else if (i.perUtteranceRouting) {
    csWer += 0.14
  } else {
    csWer += 0.22
  }
  csWer = round(Math.min(0.95, csWer), 4)

  contributions.push({
    label: 'Code-switching handling',
    deltaWer: round(csWer - monolingualWer, 4),
    note: i.codeSwitchAware
      ? 'A recogniser trained on the mixed variety treats "order" inside a Hindi sentence as an ordinary word. Still worse than monolingual, but not catastrophically.'
      : i.perUtteranceRouting
        ? 'Per-utterance routing picks one language per turn. It helps when the caller alternates between sentences and fails when they switch inside one, which is the common case.'
        : 'A single per-call language setting is wrong for every mixed utterance in both directions at once. This is the default configuration, and it is the one that produces "the agent just does not understand me".',
  })

  const effective = round(monolingualWer * (1 - i.codeSwitchRate) + csWer * i.codeSwitchRate, 4)

  const hazards = [...lang.hazards]
  if (!i.codeSwitchAware && i.codeSwitchRate > 0.2) {
    hazards.push(
      `About ${Math.round(i.codeSwitchRate * 100)}% of utterances mix languages and none of them are being handled as such.`,
    )
  }
  if (i.channel === 'phone' && !i.customVocabulary) {
    hazards.push('Names, order numbers and addresses on 8 kHz audio without vocabulary biasing — expect read-back confirmations to be necessary rather than polite.')
  }

  return {
    wer: effective,
    monolingualWer,
    codeSwitchedWer: csWer,
    contributions: contributions.sort((a, b) => Math.abs(b.deltaWer) - Math.abs(a.deltaWer)),
    hazards,
  }
}

// ---------------------------------------------------------------------------
// A worked transcript
// ---------------------------------------------------------------------------

export interface TaggedToken {
  text: string
  lang: 'en' | 'hi' | 'number'
}

export interface CodeSwitchExample {
  id: string
  /** What the caller said, as tokens tagged by language. */
  spoken: TaggedToken[]
  meaning: string
  /** What a monolingual English recogniser hears. */
  heardAsEnglish: string
  /** What a monolingual Hindi recogniser hears. */
  heardAsHindi: string
  /** What a code-switch-aware recogniser hears. */
  heardAware: string
  /** The consequence downstream, which is the part that matters. */
  consequence: string
}

export const CODE_SWITCH_EXAMPLES: CodeSwitchExample[] = [
  {
    id: 'order-status',
    spoken: [
      { text: 'मेरा', lang: 'hi' },
      { text: 'order', lang: 'en' },
      { text: 'कहाँ', lang: 'hi' },
      { text: 'है', lang: 'hi' },
    ],
    meaning: 'Where is my order?',
    heardAsEnglish: 'mera order kaha hai',
    heardAsHindi: 'मेरा ऑर्डर कहाँ है',
    heardAware: 'मेरा order कहाँ है',
    consequence:
      'All three are arguably "correct" transcriptions, and that is the problem: your intent classifier was trained on exactly one of them. The English transliteration and the Devanagari version do not match the same rule, so the same sentence routes to two different intents depending on which model answered.',
  },
  {
    id: 'refund',
    spoken: [
      { text: 'payment', lang: 'en' },
      { text: 'हो', lang: 'hi' },
      { text: 'गया', lang: 'hi' },
      { text: 'but', lang: 'en' },
      { text: 'refund', lang: 'en' },
      { text: 'नहीं', lang: 'hi' },
      { text: 'आया', lang: 'hi' },
    ],
    meaning: 'The payment went through but the refund has not arrived.',
    heardAsEnglish: 'payment ho gaya but refund nahi aaya',
    heardAsHindi: 'पेमेंट हो गया बट रिफंड नहीं आया',
    heardAware: 'payment हो गया but refund नहीं आया',
    consequence:
      'The Hindi-only model transliterates "but" into a Devanagari word that means nothing, and the negation attaches to the wrong clause. An agent reading that transcript can conclude the refund *did* arrive — a wrong answer delivered confidently, from a transcript that looked fine.',
  },
  {
    id: 'double-number',
    spoken: [
      { text: 'order', lang: 'en' },
      { text: 'number', lang: 'en' },
      { text: 'double', lang: 'en' },
      { text: 'five', lang: 'number' },
      { text: 'three', lang: 'number' },
      { text: 'सात', lang: 'number' },
    ],
    meaning: 'Order number 5537.',
    heardAsEnglish: 'order number double five three saat',
    heardAsHindi: 'ऑर्डर नंबर डबल फाइव थ्री सात',
    heardAware: 'order number 5 5 3 7',
    consequence:
      '"Double five" is two digits and "सात" is a digit in another language. Only a recogniser that normalises numbers across both languages produces something you can look up. Everything else needs the agent to ask again, which is the moment most callers give up.',
  },
]

// ---------------------------------------------------------------------------
// Applying an error rate to a transcript
// ---------------------------------------------------------------------------

/**
 * Deterministically corrupt a transcript at a given word error rate.
 *
 * Used by the quality and evaluation labs so a WER number becomes something
 * you can read. Corruption is seeded, so the same seed and rate always produce
 * the same damaged sentence — a wrong transcript you can reproduce and argue
 * about is worth far more than a plausible-looking random one.
 */
export function corrupt(text: string, wer: number, seed: string): { text: string; errors: number } {
  const rng = new Rng(seed)
  const words = text.split(/\s+/).filter(Boolean)
  let errors = 0
  const out = words.map((w) => {
    if (!rng.chance(wer)) return w
    errors++
    const mode = rng.int(0, 3)
    if (mode === 0) return '' // deletion
    if (mode === 1) return w.length > 3 ? w.slice(0, Math.max(2, w.length - 2)) : w // truncation
    if (mode === 2) return CONFUSIONS[w.toLowerCase()] ?? `${w}?` // substitution
    return `${w} ${w}` // insertion / stutter
  })
  return { text: out.filter(Boolean).join(' '), errors }
}

/**
 * Confusion pairs that 8 kHz telephony audio actually produces.
 * ASSUMPTION about which pairs, REFERENCE about why: above 4 kHz is gone.
 */
const CONFUSIONS: Record<string, string> = {
  fifteen: 'fifty',
  fifty: 'fifteen',
  sixteen: 'sixty',
  sixty: 'sixteen',
  s: 'f',
  f: 's',
  m: 'n',
  n: 'm',
  two: 'to',
  to: 'two',
  four: 'for',
  for: 'four',
  can: 'cannot',
  cancel: 'can sell',
  order: 'odour',
  refund: 're-fund',
}

/** Word error rate between a reference and a hypothesis (Levenshtein on words). */
export function wordErrorRate(reference: string, hypothesis: string): number {
  const r = reference.toLowerCase().split(/\s+/).filter(Boolean)
  const h = hypothesis.toLowerCase().split(/\s+/).filter(Boolean)
  if (r.length === 0) return h.length === 0 ? 0 : 1
  const d: number[][] = Array.from({ length: r.length + 1 }, () => new Array<number>(h.length + 1).fill(0))
  for (let i = 0; i <= r.length; i++) d[i][0] = i
  for (let j = 0; j <= h.length; j++) d[0][j] = j
  for (let i = 1; i <= r.length; i++) {
    for (let j = 1; j <= h.length; j++) {
      d[i][j] = Math.min(
        d[i - 1][j] + 1,
        d[i][j - 1] + 1,
        d[i - 1][j - 1] + (r[i - 1] === h[j - 1] ? 0 : 1),
      )
    }
  }
  return round(d[r.length][h.length] / r.length, 4)
}
