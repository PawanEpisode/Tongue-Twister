import { describe, expect, it } from 'vitest'
import { ttsRate } from './useListenFirst'
import { pickVoice, rankVoices } from './voices'

const voice = (name: string, lang: string, localService = true) =>
  ({ name, lang, voiceURI: name, localService }) as SpeechSynthesisVoice

describe('ttsRate', () => {
  it('follows the drill speed inside a calm window', () => {
    expect(ttsRate(170)).toBe(1)
    expect(ttsRate(150)).toBeCloseTo(150 / 170)
    expect(ttsRate(40)).toBe(0.8) // never mushy
    expect(ttsRate(300)).toBe(1) // never rushed
  })
  it('applies the user fine-tune and stays in range', () => {
    expect(ttsRate(170, 1.5)).toBeCloseTo(1.5)
    expect(ttsRate(40, 0.5)).toBe(0.5)
  })
})

describe('rankVoices', () => {
  const list = [
    voice('eSpeak English', 'en-US'),
    voice('Zarvox', 'en-US'),
    voice('Deutsch', 'de-DE'),
    voice('Microsoft Aria Online (Natural)', 'en-US', false),
    voice('Daniel', 'en-GB'),
    voice('Samantha', 'en-US'),
  ]
  it('drops other languages and novelty voices, best first', () => {
    const names = rankVoices(list, 'en-US').map((v) => v.name)
    expect(names[0]).toBe('Microsoft Aria Online (Natural)')
    expect(names).not.toContain('Zarvox')
    expect(names).not.toContain('Deutsch')
    expect(names.at(-1)).toBe('eSpeak English')
  })
  it('prefers the chosen accent', () => {
    expect(rankVoices(list, 'en-GB')[0].name).toBe('Daniel')
  })
  it('honours a saved voice, else falls back to the best', () => {
    const ranked = rankVoices(list, 'en-US')
    expect(pickVoice(ranked, 'Samantha')?.name).toBe('Samantha')
    expect(pickVoice(ranked, 'gone')?.name).toBe(ranked[0].name)
    expect(pickVoice([], '')).toBeNull()
  })
})
