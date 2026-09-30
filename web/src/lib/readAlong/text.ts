/** Text helpers for Read-along: tokenising, syllable heuristic and line splitting. Pure, no DOM. */

/** Display tokens: whitespace-separated, exactly as authored (punctuation stays attached). */
export const tokenize = (text: string): string[] =>
  text.split(/\s+/).filter((t) => t.length > 0)

/** Letters/digits/apostrophes only — what timing weights are computed from. */
export const clean = (token: string): string =>
  token.toLowerCase().replace(/[^\p{L}\p{N}']/gu, '')

/** Vowel-group heuristic with a silent-e rule. Good enough for pacing, not linguistics. */
export function countSyllables(word: string): number {
  const w = clean(word)
  if (!w) return 0
  let n = (w.match(/[aeiouy]+/g) ?? []).length
  if (n > 1 && /[^aeiouyl]e$/.test(w)) n-- // "picked", "made" — but keep "ta-ble"
  return Math.max(1, n)
}

const SENTENCE_END = /[.!?…]["')\]]*$/

/** Break tokens into readable lines: at sentence ends, or once `maxWords` is reached. */
export function splitLines(tokens: string[], maxWords = 7): number[][] {
  const lines: number[][] = []
  let line: number[] = []
  tokens.forEach((token, i) => {
    line.push(i)
    if (SENTENCE_END.test(token) || line.length >= maxWords) {
      lines.push(line)
      line = []
    }
  })
  if (line.length) lines.push(line)
  return lines
}

/** Which word a character offset falls in (for speechSynthesis `boundary` events). */
export function wordIndexAtChar(text: string, charIndex: number): number {
  let index = -1
  for (const m of text.matchAll(/\S+/g)) {
    if (m.index > charIndex) break
    index++
  }
  return Math.max(0, index)
}
