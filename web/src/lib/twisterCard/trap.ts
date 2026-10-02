/**
 * Which words to mark when "Show the trap" is on.
 * Sound words start with a focus sound. The anchor is the content word repeated most.
 */

export type TrapRole = 'plain' | 'sound' | 'anchor'

export type TrapSpan = {
  text: string
  role: TrapRole
}

const MIN_LETTERS = 3

const STOP = new Set([
  'a',
  'an',
  'the',
  'by',
  'to',
  'of',
  'and',
  'or',
  'for',
  'in',
  'on',
  'at',
  'from',
  'with',
  'as',
  'so',
  'but',
  'if',
  'is',
  'it',
  'its',
  'be',
  'this',
  'that',
  'than',
  'then',
  'into',
  'over',
  'under',
  'up',
  'out',
  'not',
  'no',
  'nor',
  'yet',
])

const TOKEN = /([A-Za-z]+(?:'[A-Za-z]+)?)|([^A-Za-z']+)/g

type Piece = { text: string; word: string | null }

function lettersOf(token: string): string {
  return token.replace(/[^A-Za-z']/g, '').replace(/^'+|'+$/g, '')
}

function pieces(text: string): Piece[] {
  const out: Piece[] = []
  for (const match of text.matchAll(TOKEN)) {
    if (match[1]) {
      const word = lettersOf(match[1])
      out.push({ text: match[1], word: word || null })
    } else if (match[2]) {
      out.push({ text: match[2], word: null })
    }
  }
  return out
}

function isContent(word: string): boolean {
  return word.length >= MIN_LETTERS && !STOP.has(word.toLowerCase())
}

function startsWithSound(word: string, sounds: string[]): boolean {
  const lower = word.toLowerCase()
  return sounds.some((sound) => {
    const probe = sound.toLowerCase()
    return probe.length > 0 && lower.startsWith(probe)
  })
}

/** The earliest content word that is repeated more than any other, if it appears twice. */
function anchorWord(parts: Piece[]): string | null {
  const counts = new Map<string, number>()
  for (const part of parts) {
    if (!part.word || !isContent(part.word)) continue
    const key = part.word.toLowerCase()
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  let best: string | null = null
  let bestCount = 1
  for (const part of parts) {
    if (!part.word || !isContent(part.word)) continue
    const key = part.word.toLowerCase()
    const count = counts.get(key) ?? 0
    if (count > bestCount) {
      best = key
      bestCount = count
    }
  }
  return best
}

export function trapSpans(text: string, focusSounds: string[]): TrapSpan[] {
  const parts = pieces(text)
  const anchor = anchorWord(parts)
  const sounds = focusSounds.filter((sound) => sound.length > 0)
  return parts.map((part) => {
    if (!part.word || !isContent(part.word))
      return { text: part.text, role: 'plain' }
    const key = part.word.toLowerCase()
    if (anchor && key === anchor) return { text: part.text, role: 'anchor' }
    if (startsWithSound(part.word, sounds))
      return { text: part.text, role: 'sound' }
    return { text: part.text, role: 'plain' }
  })
}

export function hasTrap(text: string, focusSounds: string[]): boolean {
  return trapSpans(text, focusSounds).some((span) => span.role !== 'plain')
}
