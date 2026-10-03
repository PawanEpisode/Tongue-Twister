import { describe, expect, it } from 'vitest'
import { confidenceOf, judgeDrill } from './drill'

const take = (
  alts: [string, number | null][],
  over: Partial<Parameters<typeof judgeDrill>[1]> = {},
) => ({
  transcript: alts[0][0],
  alternatives: alts.map(([text, confidence]) => ({ text, confidence })),
  confidence: alts[0][1],
  durationMs: 800,
  longPauseMs: 0,
  ...over,
})

describe('confidenceOf', () => {
  it('adds up the guesses that are the word', () => {
    expect(
      confidenceOf(
        [
          { text: 'sliding', confidence: 0.4 },
          { text: 'sliding', confidence: 0.3 },
        ],
        0.4,
      ),
    ).toBeCloseTo(0.7)
  })
  it('falls back when the browser reports none', () => {
    expect(confidenceOf([{ text: 'a', confidence: null }], null)).toBeNull()
  })
})

describe('judgeDrill', () => {
  it('passes an exact word the recogniser is sure of', () => {
    expect(judgeDrill('sliding', take([['sliding', 0.9]]))).toMatchObject({
      kind: 'passed',
      close: false,
      transcript: 'sliding',
    })
  })

  it('passes a correct word however unsure the recogniser sounds, and saves no confidence', () => {
    // Real take: green on screen, then "couldn't hear you" because the number was low.
    for (const c of [0.3, 0.4, 0.55]) {
      expect(judgeDrill('sleep', take([['sleep', c]]))).toEqual({
        kind: 'passed',
        close: false,
        transcript: 'sleep',
        confidence: null,
      })
    }
  })

  it('passes when Chrome split its confidence across guesses', () => {
    expect(
      judgeDrill(
        'sliding',
        take([
          ['sliding', 0.3],
          ['slighting', 0.2],
          ['sliding', 0.25],
        ]),
      ),
    ).toMatchObject({ kind: 'passed', close: false })
  })

  it('saves the guess that matched, not the first guess', () => {
    expect(
      judgeDrill(
        'sees',
        take([
          ['seats', 0.3],
          ['sees', 0.6],
        ]),
      ),
    ).toMatchObject({ kind: 'passed', close: false, transcript: 'sees' })
  })

  it('asks for another go when the recogniser doubted it heard anything', () => {
    expect(judgeDrill('sliding', take([['sliding', 0.1]]))).toMatchObject({
      kind: 'unclear',
    })
  })

  it.each([
    ['sees', 'cease'],
    ['seats', 'seeds'],
    ['shelves', 'sales'],
  ])(
    'passes the sound-alike %s → %s as close and saves the target',
    (word, heard) => {
      expect(judgeDrill(word, take([[heard, 0.4]]))).toEqual({
        kind: 'passed',
        close: true,
        transcript: word,
        confidence: null,
      })
    },
  )

  it('passes showing → sowing: one letter off counts as near in the shared scoring', () => {
    expect(judgeDrill('showing', take([['sowing', 0.4]]))).toMatchObject({
      kind: 'passed',
      transcript: 'sowing',
      confidence: null,
    })
  })

  it('passes a take that ended before the recogniser finished: no confidence at all', () => {
    expect(judgeDrill('sleep', take([['sleep', null]]))).toMatchObject({
      kind: 'passed',
      close: false,
    })
  })

  it('misses a different word', () => {
    expect(judgeDrill('sees', take([['cheese', 0.9]]))).toMatchObject({
      kind: 'missed',
      transcript: 'cheese',
    })
  })

  it('works when the browser gave no alternatives', () => {
    expect(
      judgeDrill('sliding', {
        transcript: 'sliding',
        alternatives: [],
        confidence: null,
        durationMs: 700,
        longPauseMs: 0,
      }),
    ).toMatchObject({ kind: 'passed' })
  })

  describe('does not nail a take that is not the word', () => {
    it('never passes a take with nothing in it', () => {
      for (const t of [
        take([['', 0.9]]),
        take([['  ', null]]),
        {
          ...take([['x', null]]),
          transcript: '',
          alternatives: [],
          confidence: null,
        },
      ])
        expect(judgeDrill('sweep', t).kind).toBe('unclear')
    })

    it('misses unrelated words, however many guesses the recogniser offers', () => {
      expect(
        judgeDrill(
          'sweep',
          take([
            ['the', 0.6],
            ['a', 0.5],
            ['banana', 0.4],
          ]),
        ).kind,
      ).toBe('missed')
    })

    it('does not let a low-ranked near guess rescue a take whose best guess is something else', () => {
      expect(
        judgeDrill(
          'sweep',
          take([
            ['banana', 0.6],
            ['sleep', 0.3],
            ['seep', 0.3],
          ]),
        ).kind,
      ).toBe('missed')
    })

    it('needs a real confidence before a near or sound-alike guess counts', () => {
      expect(judgeDrill('sweep', take([['sleep', null]])).kind).not.toBe(
        'passed',
      )
      expect(judgeDrill('sweep', take([['sleep', 0.2]])).kind).not.toBe(
        'passed',
      )
      expect(judgeDrill('sees', take([['cease', null]])).kind).not.toBe(
        'passed',
      )
    })

    it('flags a one-letter-off pass as close so the screen shows what was heard', () => {
      expect(judgeDrill('showing', take([['sowing', 0.5]]))).toMatchObject({
        kind: 'passed',
        close: true,
      })
    })
  })
})
