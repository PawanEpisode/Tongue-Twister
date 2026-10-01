// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ReadItBack from './ReadItBack'
import type { WordEntry } from '#/lib/speak/display'

const e = (
  text: string,
  status: WordEntry['status'],
  heard = '',
  targetIndex = 0,
): WordEntry => ({ text, status, heard, reason: '', targetIndex })

const entries = [
  e('Seven', 'correct', '', 0),
  e('slip', 'wrong', 'sleep', 1),
  e('Such', 'missed', '', 2),
]
afterEach(cleanup)

describe('ReadItBack', () => {
  it('opens on the first word that needs work', () => {
    render(<ReadItBack entries={entries} />)
    expect(screen.getByRole('status').textContent).toContain(
      'slip sounded like “sleep”',
    )
  })
  it('shows a coaching line for the tapped word', () => {
    render(<ReadItBack entries={entries} />)
    fireEvent.click(screen.getByRole('button', { name: /Seven/ }))
    expect(screen.getByRole('status').textContent).toBe('Seven landed well.')
  })
  it('names every status in text, not only colour', () => {
    render(<ReadItBack entries={entries} />)
    expect(screen.getByRole('button', { name: 'wrong: slip' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'missed: Such' })).toBeTruthy()
  })
  it('moves between words with the arrow keys', () => {
    render(<ReadItBack entries={entries} />)
    fireEvent.keyDown(screen.getByRole('button', { name: /slip/ }), {
      key: 'ArrowRight',
    })
    expect(screen.getByRole('status').textContent).toContain(
      'Such wasn’t heard',
    )
  })
  it('lets a flagged word be disputed but not a correct one', () => {
    const send = vi.fn().mockResolvedValue(undefined)
    render(<ReadItBack entries={entries} onFeedback={send} />)
    expect(screen.getByText('Was this fair?')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Seven/ }))
    expect(screen.queryByText('Was this fair?')).toBeNull()
  })
})
