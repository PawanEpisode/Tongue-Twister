import { LAYOUT_LIST } from '#/lib/record/layouts'
import type { LayoutDef } from '#/lib/record/layouts'
import { supportFor } from '#/lib/record/capabilities'
import type { Capabilities } from '#/lib/record/capabilities'
import type { RecordingLayout } from '#/lib/api'
import { cn } from '#/lib/utils'

const FILL = {
  camera: 'fill-primary/70',
  text: 'fill-lime/60',
  screen: 'fill-cyan/40',
  accent: 'fill-pink/50',
} as const

function Thumb({ layout }: { layout: LayoutDef }) {
  const [w, h] = layout.portrait ? [90, 160] : [160, 90]
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      className={cn(
        'rounded-md bg-background/60',
        layout.portrait ? 'h-16 w-9' : 'h-12 w-20',
      )}
      aria-hidden
    >
      {layout.thumb.map((s, i) =>
        s.round ? (
          <circle
            key={i}
            cx={s.x + s.w / 2}
            cy={s.y + s.h / 2}
            r={s.w / 2}
            className={FILL[s.role]}
          />
        ) : (
          <rect
            key={i}
            x={s.x}
            y={s.y}
            width={s.w}
            height={s.h}
            rx={4}
            className={FILL[s.role]}
          />
        ),
      )}
    </svg>
  )
}

/** Layouts this device can actually record. Unsupported ones are omitted. */
export default function LayoutPicker({
  value,
  onChange,
  caps,
}: {
  value: RecordingLayout
  onChange: (id: RecordingLayout) => void
  caps: Capabilities
}) {
  const available = LAYOUT_LIST.filter((l) => supportFor(caps, l.needs).ok)
  const selected = available.find((l) => l.id === value)
  if (!available.length)
    return (
      <p className="text-sm text-muted-foreground">
        Recording isn’t available in this browser.
      </p>
    )
  return (
    <div>
      <div
        role="radiogroup"
        aria-label="Layout"
        className="grid grid-cols-2 gap-3"
      >
        {available.map((l) => {
          const checked = l.id === value
          return (
            <button
              key={l.id}
              type="button"
              role="radio"
              aria-checked={checked}
              onClick={() => onChange(l.id)}
              className={cn(
                'flex flex-col items-center gap-2 rounded-2xl border p-3 text-center transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/60',
                checked
                  ? 'border-primary bg-primary/10'
                  : 'border-border hover:border-primary/60',
              )}
            >
              <Thumb layout={l} />
              <span className="text-sm font-semibold">{l.label}</span>
            </button>
          )
        })}
      </div>
      {selected && (
        <p className="mt-3 text-sm text-muted-foreground">{selected.blurb}</p>
      )}
    </div>
  )
}
