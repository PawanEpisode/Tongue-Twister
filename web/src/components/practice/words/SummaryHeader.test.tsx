// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import SummaryHeader from './SummaryHeader'

afterEach(cleanup)

describe('SummaryHeader', () => {
  it('shows the nailed share and the three counts', () => {
    render(<SummaryHeader nailed={3} weak={9} due={4} />)
    expect(
      screen.getByRole('img', { name: '25% of your trouble words nailed' }),
    ).toBeTruthy()
    expect(screen.getByText('4 words are ready for another go.')).toBeTruthy()
    expect(screen.getByText('To work on').previousSibling?.textContent).toBe(
      '9',
    )
    expect(screen.getByText('Nailed').previousSibling?.textContent).toBe('3')
  })
  it('invites the first practice when there is nothing yet', () => {
    render(<SummaryHeader nailed={0} weak={0} due={0} />)
    expect(screen.getByText(/Say a few twisters/)).toBeTruthy()
  })
  it('congratulates a cleared list', () => {
    render(<SummaryHeader nailed={5} weak={0} due={0} />)
    expect(screen.getByText(/Every trouble word is nailed/)).toBeTruthy()
  })
})
