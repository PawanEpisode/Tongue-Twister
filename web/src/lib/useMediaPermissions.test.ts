import { describe, expect, it } from 'vitest'
import { stateFromError } from './useMediaPermissions'

describe('stateFromError', () => {
  it('maps getUserMedia failures to states the UI can explain', () => {
    expect(stateFromError('NotAllowedError')).toBe('denied')
    expect(stateFromError('NotFoundError')).toBe('unavailable')
    expect(stateFromError('NotReadableError')).toBe('in_use')
    expect(stateFromError('TypeError')).toBe('error')
  })
})
