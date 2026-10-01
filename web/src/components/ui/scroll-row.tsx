import type { ComponentProps } from 'react'
import { cn } from '#/lib/utils'

/** One-line horizontal scroller. `wrap` lets it flow onto extra lines from `sm` up. */
export function ScrollRow({
  className,
  wrap = false,
  children,
  ...props
}: ComponentProps<'div'> & { wrap?: boolean }) {
  return (
    <div
      className={cn(
        'w-full min-w-0 max-w-full overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
        wrap && 'sm:overflow-visible',
        className,
      )}
      {...props}
    >
      {/* The flex row is the scrolled content, not the scroller, so chips cannot widen the page. */}
      <div
        className={cn(
          'flex w-max gap-2 *:shrink-0',
          wrap && 'sm:w-full sm:flex-wrap',
        )}
      >
        {children}
      </div>
    </div>
  )
}

function scrollParent(el: HTMLElement | null) {
  let node = el?.parentElement ?? null
  while (node) {
    const overflow = getComputedStyle(node).overflowX
    if (overflow === 'auto' || overflow === 'scroll') return node
    node = node.parentElement
  }
  return null
}

/** Slide a marked child into a horizontal scroller without moving the page. */
export function revealInScroller(root: HTMLElement | null, selector: string) {
  const active = root?.querySelector<HTMLElement>(selector)
  const scroller = scrollParent(root)
  if (!scroller || !active) return
  const view = scroller.getBoundingClientRect()
  const item = active.getBoundingClientRect()
  if (item.left < view.left) scroller.scrollLeft -= view.left - item.left
  else if (item.right > view.right)
    scroller.scrollLeft += item.right - view.right
}
