import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu'
import {
  DAY_START_HOUR,
  NIGHT_START_HOUR,
  THEME_OPTIONS,
  useTheme,
} from '#/lib/theme'
import type { ThemePreference } from '#/lib/theme'
import { THEME_LABELS, ThemeTrigger, swatchStyle } from './ThemeMenuParts'

function clockHour(hour: number) {
  const h = hour % 12 || 12
  return `${h}:00 ${hour < 12 ? 'am' : 'pm'}`
}

const SYSTEM_HINT = `Light ${clockHour(DAY_START_HOUR)}–${clockHour(NIGHT_START_HOUR)}, your local time`

/** The full menu (Radix dropdown, ~27 KB gzip). Loaded on first use by `ThemeMenu`; never imported directly. */
export default function ThemeMenuImpl({
  defaultOpen,
}: {
  defaultOpen?: boolean
}) {
  const { preference, setPreference } = useTheme()
  return (
    <DropdownMenu defaultOpen={defaultOpen} modal={false}>
      <DropdownMenuTrigger asChild>
        <ThemeTrigger />
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
                {THEME_LABELS[option]}
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
