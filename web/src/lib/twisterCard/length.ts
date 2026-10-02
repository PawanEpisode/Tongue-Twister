/** Length bands and a reading-time hint for a generated twister. Pure: no React, no API. */

export type LengthBand = 'short' | 'medium' | 'long'

/** Pace used by the library cards. 94 words lands on ~51 sec. */
export const READ_WPM = 110

/** About four lines in the card. Longer passages offer Read all. */
export const CLAMP_WORDS = 40

export const LENGTH_LABEL: Record<LengthBand, string> = {
  short: 'Short',
  medium: 'Medium',
  long: 'Long',
}

/** Tailwind text color for the length mark. Medium is amber; the others use theme tokens. */
export const LENGTH_TONE: Record<LengthBand, string> = {
  short: 'text-cyan',
  medium: 'text-amber-400',
  long: 'text-pink',
}

export function countWords(text: string): number {
  const trimmed = text.trim()
  if (!trimmed) return 0
  return trimmed.split(/\s+/).length
}

/** Prefer the stored count. Fall back to the text so a partial payload still bands. */
export function wordCountOf(twister: {
  text: string
  word_count?: number | null
}): number {
  return typeof twister.word_count === 'number'
    ? twister.word_count
    : countWords(twister.text)
}

/** Short is 12 words or fewer, Medium is 13–40, Long is the rest. */
export function lengthBand(wordCount: number): LengthBand {
  if (wordCount <= 12) return 'short'
  if (wordCount <= 40) return 'medium'
  return 'long'
}

/** Whole seconds at {@link READ_WPM}. Never zero for a twister that has words. */
export function estimatedSeconds(wordCount: number): number {
  if (wordCount <= 0) return 0
  return Math.max(1, Math.round((wordCount * 60) / READ_WPM))
}
