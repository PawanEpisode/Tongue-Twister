import { Button } from '#/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu'
import type { ThemePreference } from '#/lib/theme'
import { THEME_COLORS, THEME_OPTIONS, useTheme } from '#/lib/theme'

const LABELS: Record<ThemePreference, string> = {
  system: 'System',
  light: 'Light',
  dark: 'Dark',
  reading: 'Reading',
}

function swatchStyle(option: ThemePreference) {
  if (option === 'system') {
    return {
      background: `linear-gradient(135deg, ${THEME_COLORS.light} 50%, ${THEME_COLORS.dark} 50%)`,
    }
  }
  return { background: THEME_COLORS[option] }
}

export default function ThemeMenu() {
  const { preference, setPreference } = useTheme()
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          aria-label={`Theme: ${LABELS[preference]}`}
          className="gap-2"
        >
          <span
            aria-hidden
            className="size-3 rounded-full border border-border"
            style={swatchStyle(preference)}
          />
          <span className="hidden sm:inline">{LABELS[preference]}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuRadioGroup
          value={preference}
          onValueChange={(value) => setPreference(value as ThemePreference)}
        >
          {THEME_OPTIONS.map((option) => (
            <DropdownMenuRadioItem key={option} value={option}>
              <span
                aria-hidden
                className="size-3 shrink-0 rounded-full border border-border"
                style={swatchStyle(option)}
              />
              {LABELS[option]}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
