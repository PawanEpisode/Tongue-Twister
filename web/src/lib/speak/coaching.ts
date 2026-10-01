/**
 * What we tell the speaker about a take: a headline, the story of the attempt, a note per word and
 * the one sound worth fixing. Pure functions over `WordEntry`/`Tally`, so the copy is easy to test
 * and every surface (Speak & score, Record review, Train) says the same thing.
 */
import type { Tally, WordEntry } from './display'

export type Headline = { title: string; story: string }

const sum = (t: Tally) => t.correct + t.near + t.wrong + t.missed

export function titleFor(score: number, tally: Tally): string {
  if (score >= 95) return 'Tongue Titan!'
  if (score >= 80) return 'Smooth talker'
  if (score >= 60) return 'Getting there'
  return tally.correct + tally.near > 0
    ? 'Tangled, but you’re close'
    : 'Tangled — try again'
}

/** One honest sentence about how the take went, from where the words stopped landing. */
export function storyFor(tally: Tally): string {
  const total = sum(tally)
  if (!total) return ''
  if (tally.correct === total) return 'Every word landed.'
  const unheard = tally.missed / total
  if (unheard >= 0.4)
    return 'You nailed the first half. Then the words stopped coming.'
  if (unheard >= 0.25)
    return 'You started strong. Then the words stopped coming.'
  if (tally.wrong + tally.near >= tally.correct)
    return 'Right idea — a few sounds slipped. Tap the marked words to see which.'
  return 'Nearly there. Tap the marked words to see what to fix.'
}

export const headlineFor = (score: number, tally: Tally): Headline => ({
  title: titleFor(score, tally),
  story: storyFor(tally),
})

/** True for a missed word with nothing but missed words after it: the speaker stopped early. */
function trailingFlags(entries: readonly WordEntry[]): boolean[] {
  const out = new Array<boolean>(entries.length).fill(false)
  let tail = true
  for (let i = entries.length - 1; i >= 0; i--) {
    const s = entries[i].status
    if (s === null) continue
    if (s !== 'missed') tail = false
    out[i] = tail
  }
  return out
}

/** What to say about every word, index-aligned with `entries`; the view bolds the word in front of it. */
export function wordNotes(entries: readonly WordEntry[]): string[] {
  const trailing = trailingFlags(entries)
  return entries.map((e, i) => {
    switch (e.status) {
      case 'correct':
        return 'landed well.'
      case 'near':
        return 'was close. One more try.'
      case 'wrong':
        return `sounded like “${e.heard}”. Slow down and say it once, cleanly.${
          e.reason === 'focus_swap'
            ? ' It’s the sound this twister trains.'
            : ''
        }`
      case 'missed':
        return trailing[i]
          ? 'wasn’t heard. Keep going to the end next time.'
          : 'wasn’t heard. Say every word, even when it’s fast.'
      default:
        return ''
    }
  })
}

/** The part of two words that differs, as `[inTarget, inHeard]`; null when it is not one short sound. */
export function soundDiff(
  target: string,
  heard: string,
): [string, string] | null {
  const t = target.toLowerCase()
  const h = heard.toLowerCase()
  if (t === h) return null
  const room = Math.min(t.length, h.length)
  let head = 0
  while (head < room && t[head] === h[head]) head++
  let tail = 0
  while (
    tail < room - head &&
    t[t.length - 1 - tail] === h[h.length - 1 - tail]
  )
    tail++
  const ts = t.slice(head, t.length - tail)
  const hs = h.slice(head, h.length - tail)
  return ts && hs && ts.length <= 3 && hs.length <= 3 ? [ts, hs] : null
}

/** Tips by `target sound|heard sound`. Anything not listed gets the generic tip. */
const TIPS: Record<string, string> = {
  'i|ee': 'Short “i”, relaxed lips.',
  'ee|i': 'Long “ee”, lips spread wide.',
  'sh|s': 'Round your lips and pull the tongue back for “sh”.',
  's|sh': 'Keep your lips relaxed and tongue tip near the teeth for “s”.',
  'th|s': 'Put the tongue tip between your teeth for “th”.',
  'th|f': 'Tongue between the teeth, not lip on teeth, for “th”.',
  'r|w': 'Pull the tongue back for “r”; don’t round the lips.',
  'l|r': 'Touch the tongue tip behind your top teeth for “l”.',
}
const genericTip = (target: string, sound: string) =>
  `Listen for the “${sound}” in “${target}” and say it once, cleanly.`

const COUNT_WORDS = [
  'No',
  'One',
  'Two',
  'Three',
  'Four',
  'Five',
  'Six',
  'Seven',
  'Eight',
  'Nine',
  'Ten',
]
const countWord = (n: number) => COUNT_WORDS[n] ?? String(n)

export type TopFix = { heard: string; target: string; tip: string }

/**
 * The single most common sound slip, so the speaker has one thing to work on rather than a list.
 * Falls back to the first slipped word when the slips share no sound.
 */
export function topFix(entries: readonly WordEntry[]): TopFix | null {
  const slips = entries.filter(
    (e) => (e.status === 'wrong' || e.status === 'near') && e.heard,
  )
  const groups = new Map<
    string,
    { first: WordEntry; ts: string; hs: string; n: number }
  >()
  for (const e of slips) {
    const diff = soundDiff(e.text, e.heard)
    if (!diff) continue
    const key = diff.join('|')
    const g = groups.get(key)
    if (g) g.n++
    else groups.set(key, { first: e, ts: diff[0], hs: diff[1], n: 1 })
  }
  const best = [...groups.entries()].sort((a, b) => b[1].n - a[1].n)[0]
  if (best) {
    const [key, g] = best
    const tip = TIPS[key] ?? genericTip(g.first.text, g.ts)
    return {
      heard: g.first.heard,
      target: g.first.text,
      tip: `${tip} ${countWord(g.n)} ${g.n === 1 ? 'word' : 'words'} slid into “${g.hs}”.`,
    }
  }
  const first = slips[0]
  return first
    ? {
        heard: first.heard,
        target: first.text,
        tip: 'Slow down and say it once, cleanly.',
      }
    : null
}
