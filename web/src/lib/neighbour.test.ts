import { describe, expect, it } from 'vitest'
import { neighbour } from './neighbour'

describe('neighbour', () => {
  const list = ['a', 'b', 'c']
  it('moves within the list and wraps around', () => {
    expect(neighbour(list, 'a', 1)).toBe('b')
    expect(neighbour(list, 'c', 1)).toBe('a')
    expect(neighbour(list, 'a', -1)).toBe('c')
  })
  it('has no answer without context', () => {
    expect(neighbour([], 'a', 1)).toBeUndefined()
    expect(neighbour(['a'], 'a', 1)).toBeUndefined()
    expect(neighbour(list, 'zzz', 1)).toBeUndefined()
  })
})
