// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DeleteDialogWrapper } from './delete-dialog'

afterEach(cleanup)

describe('DeleteDialogWrapper', () => {
  it('shows a destructive confirm action for a remove flow', () => {
    render(
      <DeleteDialogWrapper
        open
        onOpenChange={() => {}}
        title="Delete this twister?"
        description="It will be removed from your account for good."
        preview="Big bold barking dogs"
        onConfirm={() => {}}
      />,
    )
    expect(
      screen.getByRole('heading', { name: 'Delete this twister?' }),
    ).toBeTruthy()
    expect(screen.getByText('Big bold barking dogs')).toBeTruthy()
    const confirm = screen.getByRole('button', { name: 'Delete' })
    expect(confirm.className).toMatch(/bg-destructive/)
    expect(screen.getByRole('button', { name: 'Keep it' })).toBeTruthy()
  })

  it('confirms and cancels', () => {
    const onConfirm = vi.fn()
    const onOpenChange = vi.fn()
    render(
      <DeleteDialogWrapper
        open
        onOpenChange={onOpenChange}
        title="Delete this recording?"
        onConfirm={onConfirm}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    fireEvent.click(screen.getByRole('button', { name: 'Keep it' }))
    expect(onConfirm).toHaveBeenCalledOnce()
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('uses a custom cancel handler and blocks confirm while pending', () => {
    const onConfirm = vi.fn()
    const onCancel = vi.fn()
    render(
      <DeleteDialogWrapper
        open
        onOpenChange={() => {}}
        title="Delete your account?"
        confirmLabel="Delete my account"
        cancelLabel="Keep my account"
        pending
        pendingLabel="Deleting…"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    )
    const confirm = screen.getByRole<HTMLButtonElement>('button', {
      name: 'Deleting…',
    })
    expect(confirm.disabled).toBe(true)
    fireEvent.click(confirm)
    fireEvent.click(screen.getByRole('button', { name: 'Keep my account' }))
    expect(onConfirm).not.toHaveBeenCalled()
    expect(onCancel).toHaveBeenCalledOnce()
  })
})
