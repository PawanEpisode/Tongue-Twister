/** ARPAbet confusion map — a port of api/twisters/speak/engine/phones.py. */

const PAIRS: [string, string][] = [
  ['S', 'SH'], ['Z', 'ZH'], ['S', 'Z'], ['SH', 'ZH'], ['S', 'TH'], ['Z', 'DH'], ['TH', 'DH'],
  ['TH', 'F'], ['DH', 'V'], ['F', 'V'], ['SH', 'CH'], ['ZH', 'JH'], ['CH', 'JH'], ['CH', 'T'],
  ['T', 'D'], ['P', 'B'], ['K', 'G'], ['P', 'T'], ['T', 'K'], ['P', 'K'], ['B', 'D'], ['D', 'G'],
  ['B', 'G'], ['T', 'TH'], ['D', 'DH'], ['M', 'N'], ['N', 'NG'], ['M', 'NG'], ['R', 'L'],
  ['W', 'V'], ['R', 'W'], ['IY', 'IH'], ['EH', 'IH'], ['EH', 'AE'], ['AA', 'AO'], ['UW', 'UH'],
  ['AH', 'AA'], ['AO', 'OW'], ['AH', 'UH'],
] // prettier-ignore

const NEIGHBOURS = new Map<string, Set<string>>()
for (const [a, b] of PAIRS) {
  if (!NEIGHBOURS.has(a)) NEIGHBOURS.set(a, new Set())
  if (!NEIGHBOURS.has(b)) NEIGHBOURS.set(b, new Set())
  NEIGHBOURS.get(a)!.add(b)
  NEIGHBOURS.get(b)!.add(a)
}

/** Sorted, de-duplicated candidates a speaker might say instead of `phone` (only labels in `vocab`). */
export function confusables(
  phone: string,
  focus: ReadonlySet<string>,
  vocab: readonly string[],
): string[] {
  const found = new Set(NEIGHBOURS.get(phone) ?? [])
  if (focus.has(phone)) for (const f of focus) found.add(f)
  found.delete(phone)
  const allowed = new Set(vocab)
  return [...found].filter((q) => allowed.has(q)).sort()
}
