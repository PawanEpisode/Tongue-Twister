// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ScoreCardPublic } from '#/lib/api'
import ScoreCardView from './ScoreCardView'

const invalidate = vi.fn()
vi.mock('@tanstack/react-router', () => ({
  Link: ({
    to,
    params,
    children,
    ...rest
  }: { to: string; params?: { slug: string }; children: ReactNode } & Record<
    string,
    unknown
  >) => (
    <a href={params ? to.replace('$slug', params.slug) : to} {...rest}>
      {children}
    </a>
  ),
  useRouter: () => ({ invalidate }),
}))

const card: ScoreCardPublic = {
  score: 87,
  accuracy: 0.92,
  wpm: 118,
  kind: 'test',
  twister: { slug: 'red-lorry', text: 'Red lorry, yellow lorry' },
  words: [
    { target: 'red', status: 'correct' },
    { target: 'lorry', status: 'near' },
    { target: 'yellow', status: 'wrong' },
    { target: 'lorry', status: 'missed' },
  ],
  created_at: '2026-10-01T10:00:00Z',
}
afterEach(cleanup)

describe('ScoreCardView', () => {
  it('shows the score, the twister and the stats', () => {
    render(<ScoreCardView state={{ kind: 'ok', card }} />)
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(
      'Scored 87 on a tongue twister',
    )
    expect(screen.getByText('87')).toBeTruthy() // visible in the server-rendered ring
    expect(screen.getByText('“Red lorry, yellow lorry”')).toBeTruthy()
    expect(screen.getByText('92%')).toBeTruthy()
    expect(screen.getByText('118 wpm')).toBeTruthy()
  })

  it('names each word status in text, not just colour', () => {
    render(<ScoreCardView state={{ kind: 'ok', card }} />)
    const chips = screen.getByRole('list', { name: 'Word by word' })
    expect(chips.textContent).toContain('red (correct)')
    expect(chips.textContent).toContain('lorry (close)')
    expect(chips.textContent).toContain('yellow (wrong)')
    expect(chips.textContent).toContain('lorry (missed)')
  })

  it('leaves out words that were not in the twister', () => {
    const withExtra = {
      ...card,
      words: [{ target: 'um', status: 'extra' as const }],
    }
    render(<ScoreCardView state={{ kind: 'ok', card: withExtra }} />)
    expect(screen.queryByRole('list', { name: 'Word by word' })).toBeNull()
  })

  it('offers to try the twister and to make a card of your own', () => {
    render(<ScoreCardView state={{ kind: 'ok', card }} />)
    expect(
      screen
        .getByRole('link', { name: 'Try this twister' })
        .getAttribute('href'),
    ).toBe('/twisters/red-lorry')
    expect(
      screen.getByRole('link', { name: 'Make your own score card' }),
    ).toBeTruthy()
  })

  it('uses the owner name only when there is one', () => {
    const { rerender } = render(
      <ScoreCardView
        state={{
          kind: 'ok',
          card: { ...card, owner: { display_name: 'Ana' } },
        }}
      />,
    )
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(
      'Ana scored 87 on a tongue twister',
    )
    rerender(
      <ScoreCardView
        state={{ kind: 'ok', card: { ...card, owner: { display_name: null } } }}
      />,
    )
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(
      'Scored 87 on a tongue twister',
    )
  })

  it.each([
    ['gone', 'This link has expired or was removed'],
    ['missing', 'We can’t find this score card'],
    ['unavailable', 'Score cards are paused'],
  ] as const)('shows a friendly page for %s', (kind, title) => {
    render(<ScoreCardView state={{ kind }} />)
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(title)
    expect(
      screen.getByRole('link', { name: 'Try a tongue twister' }),
    ).toBeTruthy()
  })

  it('offers a retry when loading failed', () => {
    render(<ScoreCardView state={{ kind: 'error' }} />)
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(invalidate).toHaveBeenCalled()
  })
})
