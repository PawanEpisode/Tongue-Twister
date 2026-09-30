import { describe, expect, it } from 'vitest'
import { buildMarkers, markersFromApi, nextMarker } from './markers'
import type { WordTiming } from './timings'

const timings: WordTiming[] = ['peter', 'piper', 'picked', 'a'].map(
  (word, index) => ({
    index,
    word,
    startMs: index * 1000,
    endMs: (index + 1) * 1000,
  }),
)

describe('markers', () => {
  it('marks wrong and missed words red and close words amber, nothing else', () => {
    const m = buildMarkers(timings, ['correct', 'near', 'missed', null], 4000)
    expect(m.map((x) => [x.word, x.severity])).toEqual([
      ['piper', 'near'],
      ['picked', 'miss'],
    ])
    expect(m[0].at).toBeCloseTo(0.25)
    expect(m[1].label).toBe('picked — missed')
  })
  it('a wrong word is a red marker too', () => {
    expect(
      buildMarkers(timings, ['wrong', 'correct', 'correct', 'correct'], 4000)[0]
        .severity,
    ).toBe('miss')
  })
  it('no markers for a clean take or a zero-length one', () => {
    expect(
      buildMarkers(timings, ['correct', 'correct', 'correct', 'correct'], 4000),
    ).toEqual([])
    expect(
      buildMarkers(timings, ['missed', 'missed', 'missed', 'missed'], 0),
    ).toEqual([])
  })
  it('builds markers from server timings and skips untimed words', () => {
    const m = markersFromApi(
      [
        {
          target_index: 0,
          target: 'peter',
          status: 'correct',
          start_ms: 0,
          end_ms: 500,
        },
        {
          target_index: 1,
          target: 'piper',
          status: 'wrong',
          start_ms: 900,
          end_ms: 1400,
        },
        {
          target_index: 2,
          target: 'picked',
          status: 'missed',
          start_ms: null,
          end_ms: null,
        },
      ],
      2000,
    )
    expect(m).toHaveLength(1)
    expect(m[0].ms).toBe(900)
  })
  it('clamps markers into the take', () => {
    const m = markersFromApi(
      [
        {
          target_index: 0,
          target: 'x',
          status: 'missed',
          start_ms: 9000,
          end_ms: 9500,
        },
      ],
      2000,
    )
    expect(m[0].ms).toBe(2000)
    expect(m[0].at).toBe(1)
  })
  it('finds the next mistake after the playhead', () => {
    const m = buildMarkers(timings, ['near', 'wrong', 'missed', null], 4000)
    expect(nextMarker(m, 0)?.word).toBe('piper')
    expect(nextMarker(m, 1000)?.word).toBe('picked')
    expect(nextMarker(m, 2500)).toBeNull()
  })
})
