/**
 * Which word a scripted swap targets, and what to ask the speaker to say, so the label is true by construction.
 * The replacement sound is the engine's own nearest confusable of the focus sound that is present in the model.
 */
import { confusables } from '../speak/engine/phones'

export type SwapPlan = {
  wordIndex: number
  word: string
  from: string
  to: string
} | null

/** What each sound is, in words a speaker knows (ARPAbet means nothing to them). */
export const PHONE_HINT: Record<string, string> = {
  S: '“s” as in sea',
  SH: '“sh” as in she',
  Z: '“z” as in zoo',
  ZH: '“zh” as in measure',
  CH: '“ch” as in cheese',
  JH: '“j” as in judge',
  P: '“p” as in pie',
  B: '“b” as in bee',
  T: '“t” as in tea',
  D: '“d” as in day',
  K: '“k” as in key',
  G: '“g” as in go',
  F: '“f” as in fee',
  V: '“v” as in van',
  TH: '“th” as in thin',
  DH: '“th” as in this',
  R: '“r” as in red',
  L: '“l” as in lie',
  W: '“w” as in we',
  Y: '“y” as in yes',
  M: '“m” as in me',
  N: '“n” as in no',
  NG: '“ng” as in sing',
  HH: '“h” as in he',
}
export const hint = (phone: string) => PHONE_HINT[phone] ?? phone

export function planSwap(
  words: readonly { text: string; variants: string[][] }[],
  focus: readonly string[],
  vocab: readonly string[],
): SwapPlan {
  const focusSet = new Set(focus)
  const phones = new Set(vocab)
  for (let i = 0; i < words.length; i++) {
    const first = words[i].variants[0] ?? []
    for (const p of first) {
      if (!focusSet.has(p)) continue
      const partner = confusables(p, focusSet, [...phones]).find((q) => q !== p)
      if (partner)
        return { wordIndex: i, word: words[i].text, from: p, to: partner }
    }
  }
  return null
}
