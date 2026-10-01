/**
 * Whole-attempt assessment from a posterior matrix — a port of api/twisters/speak/engine/assess.py.
 * Score v2 constants mirror api/twisters/speak/scoring.py (credit near 0.6, extra −0.15 capped −0.5,
 * 0.7 accuracy + 0.2 speed + 0.1 fluency, focus gate 79).
 */
import { ctcLogProb, forcedAlign } from './ctc'
import { editAlign, extraRuns, greedyDecode, wordWindows } from './decode'
import { features, substitutionTests } from './gop'
import { confusables } from './phones'
import { DEFAULT_PROFILE, FRAME_MS } from './types'
import type {
  Assessment,
  EngineStatus,
  PhonemeResult,
  Posteriors,
  ScoringProfile,
  Unscorable,
  Word,
  WordResult,
} from './types'
import { fuse, phonemeVerdict, wordStatus } from './verdict'

const CREDIT = { correct: 1, near: 0.6, wrong: 0, missed: 0, extra: -0.15 }
const EXTRA_PENALTY_CAP = -0.5
const SPEED_MIN_ACCURACY = 0.6
const PAUSE_SHARE = 0.35
const WEIGHTS = [0.7, 0.2, 0.1] as const
const FOCUS_SCORE_CAP = 79
const MIN_DURATION_MS = 500
const REFERENCE_WPM: Record<number, number> = {
  1: 110,
  2: 130,
  3: 150,
  4: 170,
}

const clamp = (v: number) => Math.max(0, Math.min(1, v))
const round = (v: number, places: number) =>
  Math.round(v * 10 ** places) / 10 ** places

function unscorable(reason: Unscorable, words: readonly Word[]): Assessment {
  return {
    unscorable: reason,
    words: words.map((w, i) => ({
      index: i,
      text: w.text,
      status: 'missed',
      reason: '',
      uncertain: false,
      variant: 0,
      start: 0,
      end: 0,
      phonemes: [],
    })),
    extras: 0,
    accuracy: 0,
    speed: 0,
    fluency: 0,
    score: 0,
    focusGated: false,
    longPauseMs: 0,
    durationMs: 0,
  }
}

type Usable = [variant: number, labels: number[]][]

function usable(words: readonly Word[], index: Map<string, number>): Usable[] {
  return words.map((word) => {
    const keep: Usable = []
    word.variants.forEach((variant, v) => {
      if (variant.length && variant.every((p) => index.has(p)))
        keep.push([v, variant.map((p) => index.get(p)!)])
    })
    if (!keep.length)
      throw new Error(
        `no variant of ${JSON.stringify(word.text)} uses phones in the model vocabulary`,
      )
    return keep
  })
}

type Pick = [variant: number, labels: number[], spans: [number, number][]]

export function assess(
  post: Posteriors,
  words: readonly Word[],
  focusPhones: readonly string[] = [],
  opts: {
    profile?: ScoringProfile
    textMatches?: readonly (boolean | null)[] | null
    durationMs?: number | null
    difficulty?: number
  } = {},
): Assessment {
  const profile = opts.profile ?? DEFAULT_PROFILE
  const focus = new Set(focusPhones)
  const logp = post.logp
  const frames = logp.length
  if (frames === 0 || words.length === 0) return unscorable('no_speech', words)
  const index = new Map(post.vocab.map((label, i) => [label, i]))
  const usableWords = usable(words, index)

  let blankFrames = 0
  for (const row of logp) {
    let best = 0
    for (let q = 1; q < row.length; q++) if (row[q] > row[best]) best = q
    if (best === 0) blankFrames++
  }
  const segments = greedyDecode(logp)
  if (!segments.length) return unscorable('no_speech', words)
  if (blankFrames / frames > profile.blankRatioMax)
    return unscorable('nothing_recognised', words)

  // Pass 1: free decode against the first variant of every word, then one window per word.
  const flat: string[] = []
  const wordOf: number[] = []
  words.forEach((word, w) => {
    for (const phone of word.variants[usableWords[w][0][0]]) {
      flat.push(phone)
      wordOf.push(w)
    }
  })
  const rows = editAlign(
    flat,
    segments.map(([label]) => post.vocab[label]),
  )
  const windows = wordWindows(
    rows,
    wordOf,
    segments,
    words.length,
    frames,
    profile.padFrames,
  )
  if (
    windows.filter((w) => w !== null).length / words.length <
    profile.minCoverage
  )
    return unscorable('could_not_follow', words)
  const extras = extraRuns(rows, profile.extraMinPhones)

  // Pass 2: constrained Viterbi inside each window; the best variant wins (ties: the earlier one).
  const chosen: (Pick | null)[] = windows.map((window, w) => {
    if (window === null) return null
    const piece = logp.slice(window[0], window[1])
    let pick: Pick | null = null
    let bestScore: number | null = null
    for (const [v, labels] of usableWords[w]) {
      const spans = forcedAlign(piece, labels)
      if (spans === null) continue
      const score = ctcLogProb(piece, labels)
      if (bestScore === null || score > bestScore) {
        bestScore = score
        pick = [
          v,
          labels,
          spans.map(
            ([a, b]) => [a + window[0], b + window[0]] as [number, number],
          ),
        ]
      }
    }
    return pick
  })

  const sequence: number[] = []
  const offsets = new Map<number, number>()
  chosen.forEach((pick, w) => {
    if (pick !== null) {
      offsets.set(w, sequence.length)
      sequence.push(...pick[1])
    }
  })

  const results: WordResult[] = words.map((word, w) => {
    const pick = chosen[w]
    const window = windows[w]
    if (pick === null || window === null)
      return {
        index: w,
        text: word.text,
        status: 'missed',
        reason: '',
        uncertain: false,
        variant: 0,
        start: 0,
        end: 0,
        phonemes: [],
      }
    const [v, labels, spans] = pick
    const phones: PhonemeResult[] = labels.map((label, k) => {
      const span = spans[k]
      const name = post.vocab[label]
      const feat = features(logp, window, span, label, 0, profile.peakRadius)
      const isFocus = focus.has(name)
      let heard = post.vocab[feat.heard]
      let subDelta: number | null = null
      let delDelta: number | null = null
      let subLabel: number | null = null
      if (isFocus || feat.peakLp < profile.tauWeak || heard !== name) {
        const cands = confusables(name, focus, post.vocab).map((q) =>
          index.get(q)!,
        )
        const tests = substitutionTests(
          logp,
          sequence,
          offsets.get(w)! + k,
          cands,
          0,
        )
        subDelta = tests.subDelta
        subLabel = tests.subLabel
        delDelta = tests.delDelta
      }
      const [verdict] = phonemeVerdict(profile, feat.peakLp, subDelta, delDelta)
      if (verdict === 'substituted' && subLabel !== null)
        heard = post.vocab[subLabel]
      else if (verdict === 'deleted') heard = ''
      const tested = [subDelta, delDelta].filter((d): d is number => d !== null)
      return {
        target: name,
        heard,
        verdict,
        start: span[0],
        end: span[1],
        delta: tested.length ? Math.min(...tested) : null,
        lpp: feat.lpp,
        lpr: feat.lpr,
        focus: isFocus,
      }
    })
    const [status, reason, uncertain] = wordStatus(phones)
    return {
      index: w,
      text: word.text,
      status,
      reason,
      uncertain,
      variant: v,
      start: spans[0][0],
      end: spans[spans.length - 1][1],
      phonemes: phones,
    }
  })

  const matches = opts.textMatches ?? null
  if (matches !== null)
    for (const res of results) {
      const match = res.index < matches.length ? matches[res.index] : null
      ;[res.status, res.reason] = fuse(
        res.status,
        res.reason,
        res.uncertain,
        match,
      )
    }

  const found = results.filter((r) => r.status !== 'missed')
  let pause = 0
  for (let i = 1; i < found.length; i++) {
    const gap = (found[i].start - found[i - 1].end) * FRAME_MS
    if (gap > profile.longPauseMs) pause += gap
  }
  const durationMs =
    opts.durationMs ??
    (found.length
      ? (found[found.length - 1].end - found[0].start) * FRAME_MS
      : 0)
  const statuses: EngineStatus[] = [
    ...results.map((r) => r.status),
    ...new Array<EngineStatus>(extras).fill('extra'),
  ]
  const reasons = [
    ...results.map((r) => r.reason),
    ...new Array<string>(extras).fill(''),
  ]
  const longPauseMs = Math.min(pause, durationMs)
  const score = scoreStatuses(statuses, reasons, {
    targetWords: words.length,
    spokenWords: found.length,
    durationMs,
    longPauseMs,
    difficulty: opts.difficulty ?? 2,
  })
  return {
    unscorable: null,
    words: results,
    extras,
    accuracy: score.accuracy,
    speed: score.speed,
    fluency: score.fluency,
    score: score.score,
    focusGated: score.focusGated,
    longPauseMs,
    durationMs,
  }
}

/** Score v2 over parallel status / reason lists (the same arithmetic as scoring.compute). */
export function scoreStatuses(
  statuses: readonly EngineStatus[],
  reasons: readonly string[],
  p: {
    targetWords: number
    spokenWords: number
    durationMs: number
    longPauseMs: number
    difficulty: number
  },
) {
  const counts = { correct: 0, near: 0, wrong: 0, missed: 0, extra: 0 }
  for (const s of statuses) counts[s]++
  const extras = Math.max(EXTRA_PENALTY_CAP, counts.extra * CREDIT.extra)
  const credit = counts.correct * CREDIT.correct + counts.near * CREDIT.near
  const accuracy = p.targetWords ? clamp((credit + extras) / p.targetWords) : 0
  const duration = Math.max(p.durationMs, MIN_DURATION_MS)
  const wpm = p.spokenWords / (duration / 60000)
  const reference = REFERENCE_WPM[p.difficulty] ?? REFERENCE_WPM[2]
  const speed = accuracy >= SPEED_MIN_ACCURACY ? clamp(wpm / reference) : 0
  const fluency = 1 - clamp(p.longPauseMs / (PAUSE_SHARE * duration))
  const raw =
    100 * (WEIGHTS[0] * accuracy + WEIGHTS[1] * speed + WEIGHTS[2] * fluency)
  const gated = reasons.includes('focus_swap')
  const uncapped = Math.floor(raw + 0.5)
  return {
    accuracy: round(accuracy, 4),
    speed: round(speed, 4),
    fluency: round(fluency, 4),
    score: gated ? Math.min(uncapped, FOCUS_SCORE_CAP) : uncapped,
    focusGated: gated && uncapped > FOCUS_SCORE_CAP,
  }
}
