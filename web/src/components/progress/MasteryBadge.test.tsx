// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { MasteryState } from '#/lib/api'
import { MASTERY, MasteryBadge } from './MasteryBadge'

afterEach(cleanup)

describe('MasteryBadge', () => {
  it('renders nothing for guests', () => {
    const { container } = render(<MasteryBadge state={null} />)
    expect(container.innerHTML).toBe('')
  })
  it.each(Object.keys(MASTERY) as MasteryState[])(
    '%s has an icon and a text label',
    (state) => {
      const { container } = render(<MasteryBadge state={state} />)
      expect(container.textContent).toBe(MASTERY[state].label)
      expect(container.querySelector('svg')).not.toBeNull()
    },
  )
})
