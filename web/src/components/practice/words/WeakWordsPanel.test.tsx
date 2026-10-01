// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import NailedWordsPanel from './NailedWordsPanel'
import WeakWordsPanel, { sessionSizes } from './WeakWordsPanel'
import type { NailedWord, WeakWord } from '#/lib/api'
import type { WordQueue } from '#/lib/wordQueues'

const weak = (word: string, drill = true): WeakWord => ({
  word,
  seen: 4,
  miss_rate: 0.5,
  weakness: 0.8,
  next_review_at: null,
  respelling: '',
  drill: drill
    ? { twister: 't', start: 0, end: 1, context: [word], context_index: 0 }
    : null,
})

function queue<T>(
  items: T[],
  count = items.length,
  fetchNextPage = vi.fn(),
): WordQueue<T> {
  return {
    items,
    count,
    remaining: Math.max(0, count - items.length),
    query: {
      isPending: false,
      isError: false,
      isFetchingNextPage: false,
      fetchNextPage,
      refetch: vi.fn(),
    },
  } as unknown as WordQueue<T>
}
afterEach(cleanup)

describe('sessionSizes', () => {
  it('offers short sessions that fit the words available', () => {
    expect(sessionSizes(0)).toEqual([])
    expect(sessionSizes(2)).toEqual([2])
    expect(sessionSizes(4)).toEqual([3, 4])
    expect(sessionSizes(40)).toEqual([3, 5, 10])
  })
})

describe('WeakWordsPanel', () => {
  const props = { dueOnly: false, onDueOnly: vi.fn(), onDrill: vi.fn() }

  it('drills the weakest few, not the whole queue', () => {
    const onDrill = vi.fn()
    const words = ['a', 'b', 'c', 'd', 'e'].map((w) => weak(w))
    render(
      <WeakWordsPanel {...props} onDrill={onDrill} queue={queue(words, 30)} />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Drill 3 weakest' }))
    expect(onDrill.mock.calls[0][0].map((w: WeakWord) => w.word)).toEqual([
      'a',
      'b',
      'c',
    ])
  })
  it('shows how many more words wait and loads them on request', () => {
    const next = vi.fn()
    const words = Array.from({ length: 10 }, (_, i) => weak(`w${i}`))
    render(<WeakWordsPanel {...props} queue={queue(words, 34, next)} />)
    fireEvent.click(screen.getByRole('button', { name: 'Show more (24 left)' }))
    expect(next).toHaveBeenCalled()
  })
  it('has no show-more once everything is loaded', () => {
    render(<WeakWordsPanel {...props} queue={queue([weak('a')])} />)
    expect(screen.queryByText(/Show more/)).toBeNull()
  })
  it('gives a word with nowhere to drill no drill button', () => {
    render(<WeakWordsPanel {...props} queue={queue([weak('a', false)])} />)
    expect(screen.queryByRole('button', { name: 'Drill a' })).toBeNull()
  })
  it('explains an empty queue', () => {
    render(<WeakWordsPanel {...props} queue={queue<WeakWord>([])} />)
    expect(screen.getByText(/No trouble words yet/)).toBeTruthy()
  })
})

describe('NailedWordsPanel', () => {
  it('lists nailed words with when they were nailed', () => {
    const w: NailedWord = {
      word: "sam's",
      respelling: '',
      mastered_at: new Date().toISOString(),
      seen: 3,
    }
    render(<NailedWordsPanel queue={queue([w])} />)
    expect(screen.getByText("sam's")).toBeTruthy()
    expect(screen.getByText('Nailed today')).toBeTruthy()
  })
  it('says what will appear here when there are none', () => {
    render(<NailedWordsPanel queue={queue<NailedWord>([])} />)
    expect(screen.getByText(/collect here/)).toBeTruthy()
  })
})
