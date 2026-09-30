import { describe, expect, it } from 'vitest'
import { buildCues, cueAt, formatVttTime, toVtt } from './captions'
import type { WordTiming } from './timings'

const timing = (words: string[], step = 500): WordTiming[] =>
  words.map((word, index) => ({
    index,
    word,
    startMs: index * step,
    endMs: (index + 1) * step,
  }))

describe('captions', () => {
  it('formats WebVTT timestamps with hours and milliseconds', () => {
    expect(formatVttTime(0)).toBe('00:00:00.000')
    expect(formatVttTime(3_723_456)).toBe('01:02:03.456')
    expect(formatVttTime(-4)).toBe('00:00:00.000')
  })
  it('groups words into cues of at most 7 words', () => {
    const t = timing(
      'one two three four five six seven eight nine ten'.split(' '),
    )
    const cues = buildCues(t)
    expect(cues).toHaveLength(2)
    expect(cues[0].text.split(' ')).toHaveLength(7)
    expect(cues[1].text).toBe('eight nine ten')
  })
  it('ends a cue at a sentence boundary', () => {
    const cues = buildCues(timing(['Hello', 'there.', 'Peter', 'Piper']))
    expect(cues.map((c) => c.text)).toEqual(['Hello there.', 'Peter Piper'])
  })
  it('splits a cue that would run too long', () => {
    const cues = buildCues(timing(['a', 'b', 'c', 'd'], 2000), { maxMs: 3500 })
    expect(cues.length).toBeGreaterThan(1)
  })
  it('writes a valid VTT file', () => {
    const vtt = toVtt(buildCues(timing(['Peter', 'Piper.'])))
    expect(vtt).toBe(
      'WEBVTT\n\n1\n00:00:00.000 --> 00:00:01.000\nPeter Piper.\n',
    )
  })
  it('escapes text that would read as markup or a cue arrow', () => {
    const vtt = toVtt([{ startMs: 0, endMs: 500, text: 'a --> b <i> & c' }])
    expect(vtt).toContain('a --&gt; b &lt;i> &amp; c')
  })
  it('an empty caption file is still valid', () => {
    expect(toVtt([])).toBe('WEBVTT\n\n')
  })
  it('finds the cue for a playback time', () => {
    const cues = buildCues(timing(['Peter', 'Piper.', 'Next', 'one.']))
    expect(cueAt(cues, 200)?.text).toBe('Peter Piper.')
    expect(cueAt(cues, 1500)?.text).toBe('Next one.')
    expect(cueAt(cues, 99_000)).toBeNull()
  })
})
