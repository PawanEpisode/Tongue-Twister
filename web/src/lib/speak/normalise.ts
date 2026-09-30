/**
 * Text normalisation — a port of api/twisters/speak/normalise.py.
 * Both sides must tokenise identically; `parity.test.ts` runs the shared vectors against this file.
 */
import data from './equivalents.json'

type Equivalents = {
  spelling: Record<string, string>
  homophones: string[][]
  fillers: string[]
}
const eq = data as Equivalents

const FILLERS = new Set(eq.fillers)
const SPELLING = new Map(Object.entries(eq.spelling))
const HOMOPHONES = (() => {
  const index = new Map<string, Set<string>>()
  for (const group of eq.homophones)
    for (const word of group) {
      const set = index.get(word) ?? new Set<string>()
      group.forEach((w) => set.add(w))
      index.set(word, set)
    }
  return index
})()

const APOSTROPHES = /[’‘`´]/g
const SEPARATORS = /[-‐‑‒–—_/\\]/g
const TOKEN = /[\p{L}\p{N}]+(?:'[\p{L}\p{N}]+)*/gu
const ORDINAL = /^(\d+)(st|nd|rd|th)$/
const DIGITS = /^\d+$/
const MARKS = /\p{M}/gu

const ONES =
  'zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen'.split(
    ' ',
  )
const TENS = '_ _ twenty thirty forty fifty sixty seventy eighty ninety'.split(
  ' ',
)
const ORDINAL_IRREGULAR: Record<string, string> = {
  one: 'first',
  two: 'second',
  three: 'third',
  five: 'fifth',
  eight: 'eighth',
  nine: 'ninth',
  twelve: 'twelfth',
}
export const MAX_SPELLED = 999_999

/** Words a recogniser may return for `word` (apostrophes ignored: they're = there). */
export function homophones(word: string): ReadonlySet<string> {
  return HOMOPHONES.get(word.replace(/'/g, '')) ?? new Set([word])
}

/** 0..999 999 as words; bigger numbers are read digit by digit. */
export function spellNumber(n: number): string[] {
  if (n < 0 || n > MAX_SPELLED)
    return [...String(Math.abs(n))].map((d) => ONES[Number(d)])
  if (n < 20) return [ONES[n]]
  if (n < 100) {
    const tens = Math.floor(n / 10),
      ones = n % 10
    return ones ? [TENS[tens], ONES[ones]] : [TENS[tens]]
  }
  if (n < 1000) {
    const rest = n % 100
    return [
      ONES[Math.floor(n / 100)],
      'hundred',
      ...(rest ? spellNumber(rest) : []),
    ]
  }
  const rest = n % 1000
  return [
    ...spellNumber(Math.floor(n / 1000)),
    'thousand',
    ...(rest ? spellNumber(rest) : []),
  ]
}

function ordinal(n: number): string[] {
  const words = spellNumber(n)
  const last = words[words.length - 1]
  words[words.length - 1] =
    ORDINAL_IRREGULAR[last] ??
    (last.endsWith('y') ? `${last.slice(0, -1)}ieth` : `${last}th`)
  return words
}

function expand(token: string): string[] {
  if (DIGITS.test(token)) return spellNumber(Number(token))
  const m = ORDINAL.exec(token)
  return m ? ordinal(Number(m[1])) : [token]
}

/** Apostrophes at the edges of a token are quote marks, not part of the word. */
export function canonical(token: string): string {
  const t = token.replace(/^'+|'+$/g, '')
  return SPELLING.get(t) ?? t
}

/** Lower-case words: no punctuation, numerals spelled, spelling unified, fillers dropped. */
export function tokenise(text: string): string[] {
  const cleaned = text
    .replace(APOSTROPHES, "'")
    .normalize('NFKD')
    .replace(MARKS, '')
    .toLowerCase()
    .replace(SEPARATORS, ' ')
  const out: string[] = []
  for (const raw of cleaned.match(TOKEN) ?? [])
    for (const piece of expand(raw.replace(/^'+|'+$/g, ''))) {
      const token = canonical(piece)
      if (token && !FILLERS.has(token)) out.push(token)
    }
  return out
}
