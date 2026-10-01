// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Profile } from '#/lib/api'
import RemindersSection from './RemindersSection'

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
  useReminders: () => q,
  useSaveReminders: () => ({ save, status: 'idle' }),
}))
afterEach(() => {
  cleanup()
  save.mockReset()
})
const me = {} as Profile

describe('RemindersSection', () => {
  it('toggles and changes the hour with the PUT shape', async () => {
    Element.prototype.scrollIntoView = () => undefined
    render(<RemindersSection me={me} locked={false} />)
    fireEvent.click(screen.getByRole('switch'))
    expect(save).toHaveBeenCalledWith({ enabled: true, hour_local: 18 })
    q = { ...q, data: { enabled: true, hour_local: 18 } }
    cleanup()
    render(<RemindersSection me={me} locked={false} />)
    fireEvent.click(screen.getByRole('combobox', { name: /send it around/i }))
    const options = await screen.findAllByRole('option')
    fireEvent.click(options[7])
    expect(save).toHaveBeenLastCalledWith({ enabled: true, hour_local: 7 })
  })
  it('is read-only while deletion is pending', () => {
    render(<RemindersSection me={me} locked />)
    expect(screen.getByRole('switch').hasAttribute('disabled')).toBe(true)
  })
})
