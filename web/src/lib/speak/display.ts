/**
 * Maps the twister's on-screen words (split on whitespace) onto scoring tokens.
 * One displayed word can be several tokens ("well-known", "21") or none ("—"), so the UI cannot
 * index scoring rows by position; this keeps that mapping in one place.
 */
import type { Aligned } from './align'
import { tokenise } from './normalise'
import type { WordReason, WordStatus } from './similarity'

export type DisplayWord = { text: string; from: number; to: number }

export function displayWords(text: string): DisplayWord[] {
  const out: DisplayWord[] = []
  let next = 0
  for (const raw of text.split(/\s+/).filter(Boolean)) {
    const n = tokenise(raw).length
    out.push({ text: raw, from: next, to: next + n })
    next += n
  }
  return out
}

/** One scored word in the shape the UI needs; both the local scorer and the API produce it. */
export type WordRow = {
  targetIndex: number | null
  spoken: string
  status: WordStatus
  reason: WordReason
}

export const rowsFromAligned = (aligned: readonly Aligned[]): WordRow[] =>
  aligned.map((a) => ({
    targetIndex: a.targetIndex,
    spoken: a.spokenWord,
    status: a.match.status,
    reason: a.match.reason,
  }))

const SEVERITY: Record<WordStatus, number> = {
  correct: 0,
  near: 1,
  wrong: 2,
  missed: 3,
  extra: 0, // extras have no target word
}

/** Worst verdict among a displayed word's tokens; null for a word that is not scored (pure punctuation). */
export function displayStatuses(
  display: readonly DisplayWord[],
  rows: readonly WordRow[],
): (WordStatus | null)[] {
  const byToken = new Map<number, WordStatus>()
  for (const r of rows)
    if (r.targetIndex != null) byToken.set(r.targetIndex, r.status)
  return display.map((d) => {
    let worst: WordStatus | null = null
    for (let i = d.from; i < d.to; i++) {
      const s = byToken.get(i) ?? 'missed'
      if (worst === null || SEVERITY[s] > SEVERITY[worst]) worst = s
    }
    return worst
  })
}

/** Words to work on: everything that was not said correctly, in twister order. */
export const problemRows = (rows: readonly WordRow[]): WordRow[] =>
  rows
    .filter((r) => r.targetIndex != null && r.status !== 'correct')
    .sort((a, b) => a.targetIndex! - b.targetIndex!)

/** Words the speaker added, in the order they were said. */
export const extraWords = (rows: readonly WordRow[]): string[] =>
  rows.filter((r) => r.status === 'extra').map((r) => r.spoken)

/** "6 of 8 words correct · 1 close · 1 missed" — the non-visual equivalent of the coloured text. */
export function summarise(rows: readonly WordRow[]): string {
  const count = (s: WordStatus) =>
    rows.filter((r) => r.status === s && r.targetIndex != null).length
  const total = rows.filter((r) => r.targetIndex != null).length
  const parts = [`${count('correct')} of ${total} words correct`]
  if (count('near')) parts.push(`${count('near')} close`)
  if (count('wrong')) parts.push(`${count('wrong')} wrong`)
  if (count('missed')) parts.push(`${count('missed')} missed`)
  const extra = rows.filter((r) => r.status === 'extra').length
  if (extra) parts.push(`${extra} extra`)
  return parts.join(' · ')
}
