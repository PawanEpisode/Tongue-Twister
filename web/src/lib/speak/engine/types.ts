/** Shapes shared by the engine modules — a port of api/twisters/speak/engine/types.py. */

export const BLANK = '<b>'
export const FRAME_MS = 20

export type PhonemeVerdict =
  'ok' | 'weak' | 'substituted' | 'deleted' | 'uncertain'
export type EngineStatus = 'correct' | 'near' | 'wrong' | 'missed' | 'extra'
export type Unscorable = 'no_speech' | 'nothing_recognised' | 'could_not_follow'

/** Log-probabilities per frame (T × V). `vocab[0]` is the CTC blank. */
export type Posteriors = { vocab: readonly string[]; logp: number[][] }

/** An expected word: normalised spelling and its accepted ARPAbet pronunciations (no stress). */
export type Word = { text: string; variants: string[][] }

/** Thresholds: placeholders until the gold set calibrates them (E3-5); precision first. */
export type ScoringProfile = {
  name: string
  tauSub: number
  tauDel: number
  tauUncertain: number
  tauWeak: number
  padFrames: number
  peakRadius: number
  minCoverage: number
  extraMinPhones: number
  blankRatioMax: number
  longPauseMs: number
}

export const DEFAULT_PROFILE: ScoringProfile = {
  name: 'sp-default-0',
  tauSub: 3.0,
  tauDel: 3.0,
  tauUncertain: 1.0,
  tauWeak: -0.9,
  padFrames: 7,
  peakRadius: 2,
  minCoverage: 0.5,
  extraMinPhones: 3,
  blankRatioMax: 0.95,
  longPauseMs: 700,
}

export type PhonemeResult = {
  target: string
  heard: string
  verdict: PhonemeVerdict
  start: number
  end: number
  delta: number | null
  lpp: number
  lpr: number
  focus: boolean
}

export type WordResult = {
  index: number
  text: string
  status: EngineStatus
  reason: string
  uncertain: boolean
  variant: number
  start: number
  end: number
  phonemes: PhonemeResult[]
}

export type Assessment = {
  unscorable: Unscorable | null
  words: WordResult[]
  extras: number
  accuracy: number
  speed: number
  fluency: number
  score: number
  focusGated: boolean
  longPauseMs: number
  durationMs: number
}
