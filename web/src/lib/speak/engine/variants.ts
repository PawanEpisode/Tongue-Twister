/**
 * Interfaces a real model, lexicon or G2P plugs into, plus accent rewrite rules — a port of
 * api/twisters/speak/engine/variants.py. A rule is off when it would neutralise a contrast the twister trains.
 */
import { tokenise } from '../normalise'
import type { Posteriors, Word } from './types'

export const MAX_VARIANTS = 8

export interface Pronouncer {
  /** ARPAbet variants without stress, or null when the word has no pronunciation. */
  variants: (word: string) => string[][] | null
}

export interface AcousticModel {
  /** Frame log-posteriors (50 frames per second, blank first) for a mono clip. */
  posteriors: (
    samples: Float32Array | readonly number[],
    sampleRate: number,
  ) => Promise<Posteriors>
}

export class UnpronounceableWords extends Error {
  readonly words: string[]
  constructor(words: string[]) {
    super(`no pronunciation for: ${words.join(', ')}`)
    this.name = 'UnpronounceableWords'
    this.words = words
  }
}

export function dictPronouncer(
  table: Readonly<Record<string, string[][]>>,
): Pronouncer {
  return {
    variants(word) {
      const found = Object.hasOwn(table, word) ? table[word] : undefined
      return found?.length ? found.map((v) => [...v]) : null
    },
  }
}

export type AccentRule = { src: string; dst: string; protects?: string[] }

/** Original variants first, then one rewritten copy per active rule and variant; de-duplicated and capped. */
export function expandVariants(
  variants: readonly string[][],
  rules: readonly AccentRule[],
  focus: ReadonlySet<string>,
): string[][] {
  const active = rules.filter(
    (r) => !(r.protects ?? []).some((p) => focus.has(p)),
  )
  const out: string[][] = []
  const seen = new Set<string>()
  const add = (variant: string[]) => {
    const key = variant.join(' ')
    if (!seen.has(key) && out.length < MAX_VARIANTS) {
      seen.add(key)
      out.push(variant)
    }
  }
  for (const variant of variants) add([...variant])
  for (const variant of variants)
    for (const rule of active)
      if (variant.includes(rule.src))
        add(variant.map((p) => (p === rule.src ? rule.dst : p)))
  return out
}

/** Normalise `text` and look every word up; a word without a pronunciation blocks the whole attempt. */
export function expectedWords(
  text: string,
  pronouncer: Pronouncer,
  opts: {
    rules?: readonly AccentRule[]
    focus?: ReadonlySet<string>
    normalise?: (text: string) => string[]
  } = {},
): Word[] {
  const tokens = (opts.normalise ?? tokenise)(text)
  const missing = tokens.filter((t) => !pronouncer.variants(t)?.length)
  if (missing.length)
    throw new UnpronounceableWords([...new Set(missing)].sort())
  return tokens.map((t) => ({
    text: t,
    variants: expandVariants(
      pronouncer.variants(t) ?? [],
      opts.rules ?? [],
      opts.focus ?? new Set(),
    ),
  }))
}
