import type { ComponentProps } from 'react'
import { Button } from '#/components/ui/button'
import type { ThemePreference } from '#/lib/theme'
import { THEME_COLORS, useTheme } from '#/lib/theme'
import { cn } from '#/lib/utils'

export const THEME_LABELS: Record<ThemePreference, string> = {
  system: 'System',
  light: 'Light',
  dark: 'Dark',
  reading: 'Reading',
}

export function swatchStyle(option: ThemePreference) {
  if (option === 'system') {
    return {
      background: `linear-gradient(135deg, ${THEME_COLORS.light} 50%, ${THEME_COLORS.dark} 50%)`,
    }
  }
  return { background: THEME_COLORS[option] }
}

/**
 * The header's theme button. It is the same markup before and after the menu library has loaded (the
 * Radix trigger renders it with `asChild`), and it carries the menu-button ARIA so assistive tech sees
 * no change when the real menu takes over.
 */
export function ThemeTrigger({
  className,
  ...props
}: ComponentProps<typeof Button>) {
  const { preference } = useTheme()
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      aria-label={`Theme: ${THEME_LABELS[preference]}`}
      aria-haspopup="menu"
      aria-expanded={false}
      className={cn('size-11 shrink-0 rounded-full p-0', className)}
      {...props}
    >
      <span
        aria-hidden
        className="size-3.5 rounded-full border border-foreground/25 shadow-sm"
        style={swatchStyle(preference)}
      />
    </Button>
  )
}
