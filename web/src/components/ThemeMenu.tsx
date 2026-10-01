import { useState } from 'react'
import type { ComponentType } from 'react'
import { ThemeTrigger } from './ThemeMenuParts'

type Impl = ComponentType<{ defaultOpen?: boolean }>
const loadMenu = () => import('./ThemeMenuImpl').then((m) => m.default as Impl)

/**
 * The theme picker in the header, on every page. The dropdown library is a large chunk that only matters
 * once someone opens the menu, so until then this renders a plain button; pointing at it or focusing it
 * warms the chunk, and pressing it loads the real menu and opens it. If the download fails the button
 * stays and the next press tries again.
 */
export default function ThemeMenu() {
  const [Menu, setMenu] = useState<Impl | null>(null)
  const [loading, setLoading] = useState(false)

  if (Menu) return <Menu defaultOpen />

  const warm = () => void loadMenu().catch(() => undefined)
  const open = () => {
    if (loading) return
    setLoading(true)
    loadMenu().then(
      (m) => setMenu(() => m),
      () => setLoading(false),
    )
  }
  return (
    <ThemeTrigger
      aria-busy={loading || undefined}
      onPointerEnter={warm}
      onFocus={warm}
      onClick={open}
      onKeyDown={(e) => {
        if (e.key === 'ArrowDown') {
          e.preventDefault()
          open()
        }
      }}
    />
  )
}
