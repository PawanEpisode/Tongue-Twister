// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as prefsModule from '#/lib/preferences'
import PreferenceSyncNote from './PreferenceSyncNote'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

function mock(sync: prefsModule.SyncState) {
  const retry = vi.fn()
  vi.spyOn(prefsModule, 'usePreferences').mockReturnValue({
    prefs: prefsModule.DEFAULT_PREFERENCES,
    update: vi.fn(),
    sync,
    ready: true,
    loaded: true,
    retry,
  })
  return retry
}

describe('PreferenceSyncNote', () => {
  it('shows a single note and a retry on error', () => {
    const retry = mock('error')
    render(<PreferenceSyncNote />)
    expect(screen.getByText(/couldn’t reach the server/i)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /retry/i }))
    expect(retry).toHaveBeenCalled()
  })
  it('has no retry when synced', () => {
    mock('synced')
    render(<PreferenceSyncNote />)
    expect(screen.queryByRole('button')).toBeNull()
  })
})
