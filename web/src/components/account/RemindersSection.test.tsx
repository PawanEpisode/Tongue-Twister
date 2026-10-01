// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Profile } from '#/lib/api'
import RemindersSection from './RemindersSection'

let flag = true
const save = vi.fn()
let q: {
  isPending: boolean
  isError: boolean
  data?: unknown
  error?: unknown
} = {
  isPending: false,
  isError: false,
  data: { enabled: false, hour_local: 18 },
}
vi.mock('#/lib/reminders/hooks', () => ({
  useRemindersEnabled: () => flag,
  useReminders: () => q,
  useSaveReminders: () => ({ save, status: 'idle' }),
}))
afterEach(() => {
  cleanup()
  flag = true
  save.mockReset()
})
const me = {} as Profile

describe('RemindersSection', () => {
  it('is inert behind the flag', () => {
    flag = false
    render(<RemindersSection me={me} locked={false} />)
    expect(screen.getByText(/aren’t available yet/)).toBeTruthy()
    expect(screen.queryByRole('switch')).toBeNull()
  })
  it('toggles and changes the hour with the PUT shape', () => {
    render(<RemindersSection me={me} locked={false} />)
    fireEvent.click(screen.getByRole('switch'))
    expect(save).toHaveBeenCalledWith({ enabled: true, hour_local: 18 })
    q = { ...q, data: { enabled: true, hour_local: 18 } }
    cleanup()
    render(<RemindersSection me={me} locked={false} />)
    fireEvent.change(screen.getByLabelText('Send it around'), {
      target: { value: '7' },
    })
    expect(save).toHaveBeenLastCalledWith({ enabled: true, hour_local: 7 })
  })
  it('is read-only while deletion is pending', () => {
    render(<RemindersSection me={me} locked />)
    expect(screen.getByRole('switch').hasAttribute('disabled')).toBe(true)
  })
})
