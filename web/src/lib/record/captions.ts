/** WebVTT captions from word timings (PRD 04 §5): grouped into short readable cues. Pure. */
import type { WordTiming } from './timings'

export type Cue = { startMs: number; endMs: number; text: string }

export const MAX_CUE_WORDS = 7
export const MAX_CUE_MS = 3500

export function buildCues(
  timings: readonly WordTiming[],
  { maxWords = MAX_CUE_WORDS, maxMs = MAX_CUE_MS } = {},
): Cue[] {
  const cues: Cue[] = []
  let group: WordTiming[] = []
  const flush = () => {
    if (!group.length) return
    cues.push({
      startMs: group[0].startMs,
      endMs: group[group.length - 1].endMs,
      text: group.map((g) => g.word).join(' '),
    })
    group = []
  }
  for (const t of timings) {
    const span = group.length ? t.endMs - group[0].startMs : 0
    if (group.length && (group.length >= maxWords || span > maxMs)) flush()
    group.push(t)
    if (/[.!?…]["')\]]*$/.test(t.word)) flush()
  }
  flush()
  return cues
}

/** 3_723_456 → "01:02:03.456"; VTT always carries hours. */
export function formatVttTime(ms: number): string {
  const total = Math.max(0, Math.round(ms))
  const h = Math.floor(total / 3_600_000)
  const m = Math.floor((total % 3_600_000) / 60_000)
  const s = Math.floor((total % 60_000) / 1000)
  const milli = total % 1000
  const p = (n: number, w = 2) => String(n).padStart(w, '0')
  return `${p(h)}:${p(m)}:${p(s)}.${p(milli, 3)}`
}

/** VTT text must not contain `-->` or `&`/`<` that would read as markup. */
const escapeCue = (t: string) =>
  t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/-->/g, '--&gt;')

export function toVtt(cues: readonly Cue[]): string {
  const body = cues
    .map(
      (c, i) =>
        `${i + 1}\n${formatVttTime(c.startMs)} --> ${formatVttTime(c.endMs)}\n${escapeCue(c.text)}`,
    )
    .join('\n\n')
  return `WEBVTT\n\n${body}${body ? '\n' : ''}`
}

/** The cue showing at `ms`, for the karaoke caption under the video. */
export const cueAt = (cues: readonly Cue[], ms: number): Cue | null =>
  cues.find((c) => ms >= c.startMs && ms < c.endMs) ?? null
