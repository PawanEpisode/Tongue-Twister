// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { AchievementView } from '#/lib/api'
import { AchievementGrid } from './AchievementGrid'

const item = (over: Partial<AchievementView>): AchievementView => ({
  code: 'x',
  name: 'X',
  description: 'Do X',
  icon: 'trophy',
  tier: 'bronze',
  category: 'start',
  xp_reward: 10,
  unlocked_at: null,
  progress: null,
  seen: true,
  ...over,
})

afterEach(cleanup)

describe('AchievementGrid', () => {
  it('lists unlocked first (newest first), then locked', () => {
    const { container } = render(
      <AchievementGrid
        items={[
          item({ code: 'a', name: 'Locked one' }),
          item({
            code: 'b',
            name: 'Old win',
            unlocked_at: '2026-09-01T10:00:00Z',
          }),
          item({
            code: 'c',
            name: 'New win',
            unlocked_at: '2026-09-30T10:00:00Z',
          }),
        ]}
      />,
    )
    const names = [...container.querySelectorAll('h3')].map(
      (h) => h.textContent,
    )
    expect(names).toEqual(['New win', 'Old win', 'Locked one'])
  })

  it('states locked/unlocked and tier in words, not colour alone', () => {
    const { container } = render(
      <AchievementGrid
        items={[
          item({ code: 'a', tier: 'gold' }),
          item({ code: 'b', unlocked_at: '2026-09-01T10:00:00Z' }),
        ]}
      />,
    )
    const text = container.textContent ?? ''
    expect(text).toContain('Locked')
    expect(text).toContain('Unlocked')
    expect(text).toContain('Gold')
    expect(text).toContain('Bronze')
  })

  it('exposes progress as a progressbar for counter-shaped locked rules only', () => {
    const { container } = render(
      <AchievementGrid
        items={[
          item({ code: 'a', name: 'Counter', progress: 0.4 }),
          item({ code: 'b', name: 'Event', progress: null }),
          item({
            code: 'c',
            name: 'Done',
            progress: 1,
            unlocked_at: '2026-09-01T10:00:00Z',
          }),
        ]}
      />,
    )
    const bars = container.querySelectorAll('[role="progressbar"]')
    expect(bars).toHaveLength(1)
    expect(bars[0].getAttribute('aria-valuenow')).toBe('40')
    expect(bars[0].getAttribute('aria-label')).toBe('Progress toward Counter')
  })

  it('keeps a masked secret masked', () => {
    const { container } = render(
      <AchievementGrid
        items={[
          item({
            code: 's',
            name: 'Secret achievement',
            description: 'Keep practising to find it.',
            icon: 'lock',
          }),
        ]}
      />,
    )
    expect(container.textContent).toContain('Secret achievement')
    expect(container.textContent).toContain('Keep practising to find it.')
  })
})
