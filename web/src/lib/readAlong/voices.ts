/** Picks the most natural-sounding voice for a language. Browsers list dozens; the default is often the worst. */

// Neural / premium voices sound human; compact and formant voices sound robotic.
const NATURAL = /natural|neural|premium|enhanced|siri|online/i
const KNOWN_GOOD =
  /\b(samantha|ava|allison|serena|daniel|karen|moira|tessa|jenny|aria|libby|sonia|google (us|uk) english)\b/i
const ROBOTIC = /compact|espeak|eloquence|festival|flite/i
const NOVELTY =
  /albert|bad news|bahh|bells|boing|bubbles|cellos|deranged|good news|hysterical|jester|organ|superstar|trinoids|whisper|wobble|zarvox/i

const tag = (lang: string) => lang.toLowerCase().replace('_', '-')

export function voiceScore(v: SpeechSynthesisVoice, lang: string): number {
  const want = tag(lang)
  const have = tag(v.lang)
  let score = 0
  if (have === want) score += 100
  else if (have.split('-')[0] === want.split('-')[0]) score += 50
  if (NATURAL.test(v.name)) score += 40
  if (KNOWN_GOOD.test(v.name)) score += 25
  if (v.localService) score += 5 // no network round-trip, so no stalls mid-line
  if (ROBOTIC.test(v.name)) score -= 60
  if (NOVELTY.test(v.name)) score -= 200
  return score
}

/** Voices of the accent's language, best first (novelty voices are dropped). */
export function rankVoices(
  voices: SpeechSynthesisVoice[],
  lang: string,
): SpeechSynthesisVoice[] {
  const language = tag(lang).split('-')[0]
  return voices
    .filter((v) => tag(v.lang).startsWith(language) && !NOVELTY.test(v.name))
    .map((v) => [v, voiceScore(v, lang)] as const)
    .sort((a, b) => b[1] - a[1])
    .map(([v]) => v)
}

/** The user's choice if this device still has it, otherwise the best available voice. */
export const pickVoice = (
  ranked: SpeechSynthesisVoice[],
  voiceURI: string,
): SpeechSynthesisVoice | null =>
  ranked.find((v) => v.voiceURI === voiceURI) ?? ranked[0] ?? null
