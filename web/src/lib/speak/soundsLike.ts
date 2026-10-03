/**
 * "Sounds like" matching for the word drill only (the shared scoring in ./similarity stays in step with the API).
 *
 * The browser recogniser turns audio into the most *likely English word*, so an isolated word comes back as its
 * nearest neighbour — "sees" as "cease", "seats" as "seeds", "shelves" as "sales", "showing" as "sowing".
 * Those pairs differ by one voicing or place of articulation. We cannot hear the difference from text alone, so
 * the drill counts them as close (and says so) rather than telling someone who said the word that they didn't.
 *
 * Words are reduced to a rough consonant skeleton: digraphs folded, voiced/voiceless pairs merged, vowels gone.
 */

const FOLDS: [RegExp, string][] = [
  [/tch/g, 's'],
  [/(sh|th|zh)/g, 's'],
  [/ch/g, 'q'], // its own sound: "cheese" is not "sees"
  [/ph/g, 'f'],
  [/wh/g, 'w'],
  [/ck/g, 'k'],
  [/qu/g, 'kw'],
  [/x/g, 'ks'],
  [/c(?=[eiy])/g, 's'],
  [/c/g, 'k'],
  [/(.)\1+/g, '$1'],
]
const PAIRS: Record<string, string> = { z: 's', d: 't', b: 'p', g: 'k', v: 'f' }

/** The consonant skeleton of a word: "shelves" → "slfs", "cease" → "ss". */
export function skeleton(word: string): string {
  let w = word.toLowerCase().replace(/[^a-z]/g, '')
  for (const [re, to] of FOLDS) w = w.replace(re, to)
  w = w
    .split('')
    .map((ch) => PAIRS[ch] ?? ch)
    .join('')
  // Vowels carry little here, and a leading y/h is a sound but a trailing or inner one is not.
  w = w.replace(/(?!^)[aeiouyh]/g, '').replace(/^[aeiou]/, '')
  return w
}

/** Is `b` reachable from `a` by one inserted, deleted or substituted letter? */
function withinOneEdit(a: string, b: string): boolean {
  if (a === b) return true
  if (Math.abs(a.length - b.length) > 1) return false
  let i = 0
  while (i < a.length && i < b.length && a[i] === b[i]) i++
  if (a.length === b.length) return a.slice(i + 1) === b.slice(i + 1)
  return a.length > b.length
    ? a.slice(i + 1) === b.slice(i)
    : a.slice(i) === b.slice(i + 1)
}

/**
 * Do `target` and `heard` sound alike? Equal skeletons always do; a skeleton of four or more consonants may differ
 * by one (a swallowed "v" in "shelves"/"sales"), but short ones must match exactly or "ice" would pass for "sees".
 */
export function soundsLike(target: string, heard: string): boolean {
  const a = skeleton(target)
  const b = skeleton(heard)
  if (!a || !b) return false
  if (a === b) return true
  return Math.max(a.length, b.length) >= 4 && withinOneEdit(a, b)
}
