import { Button } from '#/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu'
import type { ThemePreference } from '#/lib/theme'
import {
  DAY_START_HOUR,
  NIGHT_START_HOUR,
  THEME_COLORS,
  THEME_OPTIONS,
  useTheme,
} from '#/lib/theme'

const LABELS: Record<ThemePreference, string> = {
  system: 'System',
  light: 'Light',
  dark: 'Dark',
  reading: 'Reading',
}

function clockHour(hour: number) {
  const h = hour % 12 || 12
  return `${h}:00 ${hour < 12 ? 'am' : 'pm'}`
}

const SYSTEM_HINT = `Light ${clockHour(DAY_START_HOUR)}–${clockHour(NIGHT_START_HOUR)}, your local time`

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
              <span>
                {LABELS[option]}
                {option === 'system' && (
                  <span className="block text-xs font-normal text-muted-foreground">
                    {SYSTEM_HINT}
                  </span>
                )}
              </span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
