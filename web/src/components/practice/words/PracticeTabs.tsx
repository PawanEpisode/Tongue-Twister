import { cn } from '#/lib/utils'

export type Tab = { id: string; label: string; count?: number }

/** The practice page's sections as tabs, so the page stays one screen long however many words there are. */
export default function PracticeTabs({
  tabs,
  value,
  onChange,
}: {
  tabs: readonly Tab[]
  value: string
  onChange: (id: string) => void
}) {
  return (
    <div
      role="tablist"
      className="mx-auto mt-6 flex w-fit max-w-full gap-1 overflow-x-auto rounded-full border border-border bg-card/60 p-1"
    >
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          aria-selected={t.id === value}
          onClick={() => onChange(t.id)}
          className={cn(
            'whitespace-nowrap rounded-full px-4 py-1.5 text-sm font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary pointer-coarse:min-h-11',
            t.id === value
              ? 'bg-primary text-primary-foreground'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {t.label}
          {t.count != null && (
            <span className="ml-1.5 font-normal opacity-80">{t.count}</span>
          )}
        </button>
      ))}
    </div>
  )
}
