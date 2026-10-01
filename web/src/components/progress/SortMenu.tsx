import { ArrowUpDown } from 'lucide-react'
import { Button } from '#/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu'
import type { BrowseSort } from '#/lib/api'
import {
  BROWSE_SORTS,
  DEFAULT_SORT,
  SIGNED_IN_SORTS,
  SORT_LABELS,
} from '#/lib/progress/browseParams'

export function SortMenu({
  value = DEFAULT_SORT,
  onChange,
  signedIn,
}: {
  value?: BrowseSort
  onChange: (sort: BrowseSort) => void
  /** Score-based sorts need a score history, so guests don't see them. */
  signedIn: boolean
}) {
  const options = BROWSE_SORTS.filter(
    (s) => signedIn || !SIGNED_IN_SORTS.includes(s),
  )
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="gap-1.5 px-4 pointer-coarse:min-h-11"
        >
          <ArrowUpDown className="size-4" aria-hidden />
          Sort: {SORT_LABELS[value]}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuRadioGroup
          value={value}
          onValueChange={(v) => {
            const next = options.find((s) => s === v)
            if (next) onChange(next)
          }}
        >
          {options.map((s) => (
            <DropdownMenuRadioItem
              key={s}
              value={s}
              className="pointer-coarse:min-h-11"
            >
              {SORT_LABELS[s]}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
