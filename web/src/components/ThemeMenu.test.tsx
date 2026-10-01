// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type * as Theme from '#/lib/theme'
import ThemeMenu from './ThemeMenu'

vi.mock('#/lib/theme', async (orig) => ({
  ...(await orig<typeof Theme>()),
  useTheme: () => ({ preference: 'dark', setPreference: vi.fn() }),
}))

vi.mock('./ThemeMenuImpl', () => {
  return {
    default: ({ defaultOpen }: { defaultOpen?: boolean }) => (
      <div role="menu" data-open={String(defaultOpen)}>
        full menu
      </div>
    ),
  }
})

afterEach(cleanup)

const trigger = () => screen.getByRole('button', { name: 'Theme: Dark' })

describe('ThemeMenu', () => {
  it('starts as a plain menu button that carries the menu ARIA', () => {
    render(<ThemeMenu />)
    expect(trigger().getAttribute('aria-haspopup')).toBe('menu')
    expect(trigger().getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('loads the real menu, already open, when pressed', async () => {
    render(<ThemeMenu />)
    fireEvent.click(trigger())
    const menu = await screen.findByRole('menu')
    expect(menu.getAttribute('data-open')).toBe('true')
  })

  it('opens from the keyboard with ArrowDown', async () => {
    render(<ThemeMenu />)
    fireEvent.keyDown(trigger(), { key: 'ArrowDown' })
    expect(await screen.findByRole('menu')).toBeTruthy()
  })

  it('does not load the menu just for being rendered or hovered', async () => {
    render(<ThemeMenu />)
    fireEvent.pointerEnter(trigger())
    expect(screen.queryByRole('menu')).toBeNull()
    expect(trigger()).toBeTruthy()
  })

  it('stays a working button when the chunk fails, and tries again next press', async () => {
    vi.resetModules()
    let attempts = 0
    vi.doMock('./ThemeMenuImpl', () => {
      attempts += 1
      if (attempts === 1) throw new Error('Failed to fetch module')
      return { default: () => <div role="menu">full menu</div> }
    })
    const { default: Fresh } = await import('./ThemeMenu')
    render(<Fresh />)
    fireEvent.click(trigger())
    await vi.waitFor(() => expect(attempts).toBe(1))
    expect(trigger().getAttribute('aria-busy')).toBeNull()
    expect(screen.queryByRole('menu')).toBeNull()
    fireEvent.click(trigger())
    expect(await screen.findByRole('menu')).toBeTruthy()
    vi.doUnmock('./ThemeMenuImpl')
  })
})
