import { describe, expect, it } from 'vitest'
import {
  atRiskCopy,
  freezeCopy,
  milestoneCopy,
  milestoneProgress,
  streakLabel,
} from './streak'

describe('milestoneProgress', () => {
  it('reports the fraction and days left', () => {
    expect(milestoneProgress(4, 7)).toEqual({
      fraction: 4 / 7,
      target: 7,
      remaining: 3,
    })
  })
  it('is null when there is no next milestone', () => {
    expect(milestoneProgress(120, null)).toBeNull()
  })
  it('clamps an overshoot', () => {
    expect(milestoneProgress(9, 7)).toMatchObject({
      fraction: 1,
      remaining: 0,
    })
  })
})

describe('copy', () => {
  it('labels streaks', () => {
    expect(streakLabel(0)).toBe('No streak yet')
    expect(streakLabel(4)).toBe('4-day streak')
  })
  it('describes the next milestone', () => {
    expect(milestoneCopy(6, 7)).toBe('1 more day to a 7-day streak')
    expect(milestoneCopy(4, 7)).toBe('3 more days to a 7-day streak')
    expect(milestoneCopy(7, 7)).toBe('7-day streak reached!')
    expect(milestoneCopy(200, null)).toMatch(/Every milestone/)
  })
  it('describes freezes', () => {
    expect(freezeCopy(0)).toMatch(/No streak freezes/)
    expect(freezeCopy(1)).toBe(
      '1 streak freeze banked. It covers one missed day.',
    )
    expect(freezeCopy(2)).toMatch(/most you can hold/)
  })
  it('mentions a freeze in the at-risk nudge only when one is banked', () => {
    expect(atRiskCopy(4, 0)).toBe(
      'Your 4-day streak ends tonight. One twister keeps it going.',
    )
    expect(atRiskCopy(4, 1)).toMatch(/freeze has your back/)
  })
})
