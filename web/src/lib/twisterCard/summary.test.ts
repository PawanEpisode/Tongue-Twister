import { describe, expect, it } from 'vitest'
import { libraryHeadline, librarySummary } from './summary'

describe('library summary', () => {
  it('counts tries and the ones still waiting', () => {
    const summary = librarySummary([
      { attempts_count: 1 },
      { attempts_count: 0 },
      { attempts_count: 4 },
      {},
    ])
    expect(summary).toEqual({ total: 4, practised: 2, waiting: 2 })
    expect(libraryHeadline(summary)).toBe(
      '4 twisters · 2 practised · 2 waiting for a first try',
    )
  })

  it('uses the singular when there is one twister', () => {
    expect(libraryHeadline(librarySummary([{ attempts_count: 0 }]))).toBe(
      '1 twister · 0 practised · 1 waiting for a first try',
    )
  })
})
