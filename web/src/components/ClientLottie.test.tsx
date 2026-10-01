// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => {
  cleanup()
  vi.resetModules()
  vi.doUnmock('lottie-react')
})

describe('ClientLottie', () => {
  it('renders the animation once the library has loaded', async () => {
    vi.doMock('lottie-react', () => ({
      Lottie: () => <div data-testid="lottie" />,
    }))
    const { default: ClientLottie } = await import('./ClientLottie')
    render(<ClientLottie animationData={{}} fallback={<p>fallback</p>} />)
    await waitFor(() => expect(screen.getByTestId('lottie')).toBeTruthy())
    expect(screen.queryByText('fallback')).toBeNull()
  })

  it('shows the fallback, with no unhandled rejection, when the chunk fails to load', async () => {
    vi.doMock('lottie-react', () => {
      throw new Error('Failed to fetch dynamically imported module')
    })
    const { default: ClientLottie } = await import('./ClientLottie')
    render(<ClientLottie animationData={{}} fallback={<p>fallback</p>} />)
    await waitFor(() => expect(screen.getByText('fallback')).toBeTruthy())
  })

  it('renders nothing when it fails and no fallback is given', async () => {
    vi.doMock('lottie-react', () => {
      throw new Error('offline')
    })
    const { default: ClientLottie } = await import('./ClientLottie')
    const { container } = render(<ClientLottie animationData={{}} />)
    await new Promise((r) => setTimeout(r, 20))
    expect(container.innerHTML).toBe('')
  })
})
