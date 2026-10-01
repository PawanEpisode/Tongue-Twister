/** Phoneme verdicts, word status and fusion — a port of api/twisters/speak/engine/verdict.py. */
import type {
  EngineStatus,
  PhonemeResult,
  PhonemeVerdict,
  ScoringProfile,
} from './types'

/** `[verdict, deletionWon]`; both tests failing: the more negative delta wins, ties go to substitution. */
export function phonemeVerdict(
  profile: ScoringProfile,
  peakLp: number,
  subDelta: number | null,
  delDelta: number | null,
): [PhonemeVerdict, boolean] {
  const subHit = subDelta !== null && subDelta <= -profile.tauSub
  const delHit = delDelta !== null && delDelta <= -profile.tauDel
  if (subHit && delHit)
    return delDelta < subDelta ? ['deleted', true] : ['substituted', false]
  if (subHit) return ['substituted', false]
  if (delHit) return ['deleted', true]
  const deltas = [subDelta, delDelta].filter((d): d is number => d !== null)
  if (deltas.length && Math.min(...deltas) <= -profile.tauUncertain)
    return ['uncertain', false]
  if (peakLp < profile.tauWeak) return ['weak', false]
  return ['ok', false]
}

/** `[status, reason, uncertain]` from the phoneme verdicts (`missed` is decided earlier). */
export function wordStatus(
  phonemes: readonly PhonemeResult[],
): [EngineStatus, string, boolean] {
  const uncertain = phonemes.some((p) => p.verdict === 'uncertain')
  const errors = phonemes.filter(
    (p) => p.verdict === 'substituted' || p.verdict === 'deleted',
  )
  if (errors.some((p) => p.focus)) return ['wrong', 'focus_swap', uncertain]
  if (errors.length >= 2) return ['wrong', '', uncertain]
  if (errors.length === 1) return ['near', '', uncertain]
  if (phonemes.some((p) => p.verdict === 'weak'))
    return ['near', 'slurred', uncertain]
  return ['correct', '', uncertain]
}

/** Combine with the Web Speech layer. It can never turn an acoustic error into `correct`. */
export function fuse(
  status: EngineStatus,
  reason: string,
  uncertain: boolean,
  textMatch: boolean | null,
): [EngineStatus, string] {
  if (textMatch === null || status === 'missed') return [status, reason]
  if (status === 'correct' && uncertain && !textMatch)
    return ['near', 'uncertain']
  return [status, reason]
}
