/** A line that is one phrase pasted on a loop, shown once with a × N chip. */

export type RepeatedPhrase = {
  phrase: string
  times: number
}

function norm(word: string): string {
  return word.replace(/^[^A-Za-z]+|[^A-Za-z]+$/g, '').toLowerCase()
}

/**
 * The shortest phrase that tiles the whole line at least twice.
 * Punctuation and case do not break a match. Anything else returns null.
 */
export function repeatedPhrase(text: string): RepeatedPhrase | null {
  const words = text.trim().split(/\s+/).filter(Boolean)
  if (words.length < 2) return null
  const keys = words.map(norm)
  const limit = Math.floor(words.length / 2)
  for (let period = 1; period <= limit; period++) {
    if (words.length % period !== 0) continue
    const times = words.length / period
    const phrase = keys.slice(0, period)
    if (phrase.some((word) => word.length === 0)) continue
    let same = true
    for (let i = 0; i < keys.length; i++) {
      if (keys[i] !== phrase[i % period]) {
        same = false
        break
      }
    }
    if (same) return { phrase: words.slice(0, period).join(' '), times }
  }
  return null
}
