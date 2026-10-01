import { CategoryIcon } from '#/lib/categoryIcons'
import type { BrowseSort, BrowseStatus, Category, Facets } from '#/lib/api'
import { ChipsSkeleton } from '#/components/feedback'
import { RandomButton } from '#/components/progress/RandomButton'
import { SortMenu } from '#/components/progress/SortMenu'
import { StatusChips } from '#/components/progress/StatusChips'
import { Chip } from '#/components/ui/chip'
import { Label } from '#/components/ui/label'
import { ScrollRow } from '#/components/ui/scroll-row'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#/components/ui/select'
import { BROWSE_STATUSES, STATUS_LABELS } from '#/lib/progress/browseParams'

const LEVELS = ['Easy', 'Medium', 'Hard', 'Insane']
const ANY = 'any'

function FilterSelect({
  label,
  value,
  onValueChange,
  options,
}: {
  label: string
  value: string
  onValueChange: (value: string) => void
  options: { value: string; label: string }[]
}) {
  return (
    <div className="min-w-0 space-y-1">
      <Label className="text-xs font-normal text-muted-foreground">
        {label}
      </Label>
      <Select value={value} onValueChange={onValueChange}>
        <SelectTrigger aria-label={label} className="py-2">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

type Patch = {
  difficulty?: string
  origin?: string
  category?: string
  status?: BrowseStatus
  sort?: BrowseSort
}

/** Level, origin, sound, and progress filters. Phones use menus; wider screens use chips. */
export function BrowseFilters({
  difficulty,
  origin,
  category,
  status,
  sort,
  signedIn,
  counts,
  categories,
  categoriesPending,
  categoriesError,
  onRetryCategories,
  onChange,
}: {
  difficulty?: string
  origin?: string
  category?: string
  status?: BrowseStatus
  sort?: BrowseSort
  signedIn: boolean
  counts?: Facets
  categories?: Category[]
  categoriesPending: boolean
  categoriesError: boolean
  onRetryCategories: () => void
  onChange: (patch: Patch) => void
}) {
  const filters = { difficulty, category, origin }
  const levelOptions = [
    { value: ANY, label: 'All levels' },
    ...LEVELS.map((name, i) => ({
      value: String(i + 1),
      label: counts?.levels[String(i + 1)]
        ? `${name} ${counts.levels[String(i + 1)]}`
        : name,
    })),
  ]
  const originOptions = [
    { value: ANY, label: 'Classic + Modern' },
    {
      value: 'classic',
      label: counts?.origins.classic
        ? `Classic ${counts.origins.classic}`
        : 'Classic',
    },
    {
      value: 'modern',
      label: counts?.origins.modern
        ? `Modern ${counts.origins.modern}`
        : 'Modern',
    },
  ]
  const soundOptions = [
    { value: ANY, label: 'Every sound' },
    ...(categories?.map((c) => ({
      value: c.slug,
      label: counts?.categories[c.slug]
        ? `${c.name} ${counts.categories[c.slug]}`
        : c.name,
    })) ?? []),
  ]
  const progressOptions = [
    { value: ANY, label: 'Any progress' },
    ...BROWSE_STATUSES.map((status) => ({
      value: status,
      label: STATUS_LABELS[status],
    })),
  ]
  return (
    <div className="mt-5 space-y-3">
      <div className="grid grid-cols-2 gap-2 md:hidden">
        <FilterSelect
          label="Difficulty"
          value={difficulty ?? ANY}
          onValueChange={(value) =>
            onChange({ difficulty: value === ANY ? undefined : value })
          }
          options={levelOptions}
        />
        <FilterSelect
          label="Origin"
          value={origin ?? ANY}
          onValueChange={(value) =>
            onChange({ origin: value === ANY ? undefined : value })
          }
          options={originOptions}
        />
        <div className={signedIn ? '' : 'col-span-2'}>
          <FilterSelect
            label="Sound"
            value={category ?? ANY}
            onValueChange={(value) =>
              onChange({ category: value === ANY ? undefined : value })
            }
            options={
              categoriesError
                ? [{ value: ANY, label: 'Couldn’t load sounds' }]
                : soundOptions
            }
          />
        </div>
        {signedIn && (
          <FilterSelect
            label="Progress"
            value={status ?? ANY}
            onValueChange={(value) =>
              onChange({
                status: value === ANY ? undefined : (value as BrowseStatus),
              })
            }
            options={progressOptions}
          />
        )}
      </div>
      <div className="hidden space-y-3 md:block">
        <ScrollRow wrap aria-label="Difficulty">
          <Chip
            on={!difficulty}
            onClick={() => onChange({ difficulty: undefined })}
          >
            All levels
          </Chip>
          {LEVELS.map((name, i) => (
            <Chip
              key={name}
              on={difficulty === String(i + 1)}
              count={counts?.levels[String(i + 1)]}
              onClick={() => onChange({ difficulty: String(i + 1) })}
            >
              {name}
            </Chip>
          ))}
        </ScrollRow>
        <ScrollRow wrap aria-label="Origin">
          <Chip on={!origin} onClick={() => onChange({ origin: undefined })}>
            Classic + Modern
          </Chip>
          <Chip
            on={origin === 'classic'}
            count={counts?.origins.classic}
            onClick={() => onChange({ origin: 'classic' })}
          >
            Classic
          </Chip>
          <Chip
            on={origin === 'modern'}
            count={counts?.origins.modern}
            onClick={() => onChange({ origin: 'modern' })}
          >
            Modern
          </Chip>
        </ScrollRow>
        <ScrollRow wrap aria-label="Sound">
          <Chip
            on={!category}
            onClick={() => onChange({ category: undefined })}
          >
            Every sound
          </Chip>
          {categoriesPending && <ChipsSkeleton />}
          {categoriesError && (
            <Chip on={false} onClick={onRetryCategories}>
              Couldn’t load sounds — retry
            </Chip>
          )}
          {categories?.map((c) => (
            <Chip
              key={c.slug}
              on={category === c.slug}
              count={counts?.categories[c.slug]}
              className="gap-1.5"
              onClick={() => onChange({ category: c.slug })}
            >
              <CategoryIcon slug={c.slug} className="size-3.5" />
              {c.name}
            </Chip>
          ))}
        </ScrollRow>
        {signedIn && (
          <StatusChips
            value={status}
            onChange={(next) => onChange({ status: next })}
          />
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <RandomButton filters={filters} />
        <SortMenu
          value={sort}
          signedIn={signedIn}
          onChange={(next) => onChange({ sort: next })}
        />
      </div>
    </div>
  )
}
