// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import DeleteAccountDialog from './DeleteAccountDialog'

const mutate = vi.fn()
let request = {
  mutate,
  isPending: false,
  isError: false,
  error: null as unknown,
  reset: vi.fn(),
}
vi.mock('#/lib/account/useDeletion', () => ({
  useRequestDeletion: () => request,
}))
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  request = {
    mutate,
    isPending: false,
    isError: false,
    error: null,
    reset: vi.fn(),
  }
})

const deleteButton = () =>
  screen.getByRole<HTMLButtonElement>('button', { name: 'Delete my account' })
const type = (v: string) =>
  fireEvent.change(screen.getByLabelText(/Type DELETE to confirm/), {
    target: { value: v },
  })

describe('DeleteAccountDialog', () => {
  it('explains the grace period and what is deleted', () => {
    render(<DeleteAccountDialog open onClose={() => {}} />)
    expect(screen.getByRole('dialog').textContent).toMatch(/30 days/)
    expect(screen.getByRole('dialog').textContent).toMatch(/recordings/)
  })

  it('stays closed when closed', () => {
    render(<DeleteAccountDialog open={false} onClose={() => {}} />)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('cannot be sent until DELETE is typed exactly', () => {
    render(<DeleteAccountDialog open onClose={() => {}} />)
    expect(deleteButton().disabled).toBe(true)
    type('delete')
    expect(deleteButton().disabled).toBe(true)
    type('DELETE')
    expect(deleteButton().disabled).toBe(false)
  })

  it('does nothing when the form is submitted without the word', () => {
    render(<DeleteAccountDialog open onClose={() => {}} />)
    fireEvent.submit(screen.getByRole('dialog').querySelector('form')!)
    expect(mutate).not.toHaveBeenCalled()
  })

  it('requests deletion and closes on success', () => {
    const onClose = vi.fn()
    mutate.mockImplementation((_v, opts: { onSuccess: () => void }) =>
      opts.onSuccess(),
    )
    render(<DeleteAccountDialog open onClose={onClose} />)
    type('DELETE')
    fireEvent.click(deleteButton())
    expect(mutate).toHaveBeenCalledOnce()
    expect(onClose).toHaveBeenCalled()
  })

  it('"Keep my account" closes without sending anything', () => {
    const onClose = vi.fn()
    render(<DeleteAccountDialog open onClose={onClose} />)
    fireEvent.click(screen.getByRole('button', { name: 'Keep my account' }))
    expect(onClose).toHaveBeenCalled()
    expect(mutate).not.toHaveBeenCalled()
  })

  it('shows a failure and stays open', () => {
    request = { ...request, isError: true, error: new Error('API 500') }
    render(<DeleteAccountDialog open onClose={() => {}} />)
    expect(screen.getByRole('alert').textContent).toMatch(/try again/i)
  })
})
