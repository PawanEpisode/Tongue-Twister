import type { ComponentProps } from 'react'
import { Button } from '#/components/ui/button'
import type { ThemePreference } from '#/lib/theme'
import { THEME_COLORS, useTheme } from '#/lib/theme'

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
export function ThemeTrigger(props: ComponentProps<typeof Button>) {
  const { preference } = useTheme()
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      aria-label={`Theme: ${THEME_LABELS[preference]}`}
      aria-haspopup="menu"
      aria-expanded={false}
      className="gap-2"
      {...props}
    >
      <span
        aria-hidden
        className="size-3 rounded-full border border-border"
        style={swatchStyle(preference)}
      />
      <span className="hidden sm:inline">{THEME_LABELS[preference]}</span>
    </Button>
  )
}
