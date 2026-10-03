import { describe, expect, it } from 'vitest'
import type { TimelineEvent } from '#/lib/api'
import { describeEvent, groupByDay } from './timeline'

const ev = (
  kind: TimelineEvent['kind'],
  data: Record<string, unknown> = {},
  created_at = '2026-10-03T10:00:00',
  id = 1,
): TimelineEvent => ({ id, kind, data, created_at })

describe('describeEvent', () => {
  it('reads each kind', () => {
    expect(describeEvent(ev('level_up', { level: 5 })).title).toBe(
      'Reached level 5',
    )
    expect(describeEvent(ev('streak_milestone', { days: 7 })).title).toBe(
      '7-day streak',
    )
    expect(
      describeEvent(ev('achievement', { name: 'First Word', tier: 'bronze' })),
    ).toMatchObject({
      title: 'Unlocked First Word',
      detail: 'bronze',
    })
    expect(
      describeEvent(ev('personal_best', { score: 91, twister: 'she-sells' })),
    ).toMatchObject({ title: 'New personal best: 91', detail: 'she sells' })
  })
  it('survives missing data and unknown kinds', () => {
    expect(describeEvent(ev('level_up')).title).toContain('level')
    expect(describeEvent(ev('personal_best')).title).toBe('New personal best')
    expect(describeEvent(ev('nope' as never)).title).toBe('Something happened')
  })
})

describe('groupByDay', () => {
  const now = new Date('2026-10-03T12:00:00')
  it('labels today and yesterday and keeps order', () => {
    const groups = groupByDay(
      [
        ev('level_up', {}, '2026-10-03T09:00:00', 3),
        ev('level_up', {}, '2026-10-03T08:00:00', 2),
        ev('level_up', {}, '2026-10-02T20:00:00', 1),
      ],
      now,
    )
    expect(groups.map((g) => [g.label, g.events.length])).toEqual([
      ['Today', 2],
      ['Yesterday', 1],
    ])
  })
  it('is empty for no events', () => {
    expect(groupByDay([], now)).toEqual([])
  })
})
