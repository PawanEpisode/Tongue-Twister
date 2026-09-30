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

/** Radio group of layouts. Unsupported ones stay visible but disabled, with the reason as text. */
export default function LayoutPicker({
  value,
  onChange,
  caps,
}: {
  value: RecordingLayout
  onChange: (id: RecordingLayout) => void
  caps: Capabilities
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Layout"
      className="grid gap-3 sm:grid-cols-2"
    >
      {LAYOUT_LIST.map((l) => {
        const support = supportFor(caps, l.needs)
        const checked = l.id === value
        return (
          <button
            key={l.id}
            type="button"
            role="radio"
            aria-checked={checked}
            disabled={!support.ok}
            onClick={() => onChange(l.id)}
            className={cn(
              'flex items-center gap-3 rounded-2xl border p-3 text-left transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/60 disabled:cursor-not-allowed disabled:opacity-50',
              checked
                ? 'border-primary bg-primary/10'
                : 'border-border hover:border-primary/60',
            )}
          >
            <Thumb layout={l} />
            <span className="min-w-0">
              <span className="block text-sm font-semibold">{l.label}</span>
              <span className="block text-xs text-muted-foreground">
                {support.ok ? l.blurb : support.reason}
              </span>
            </span>
          </button>
        )
      })}
    </div>
  )
}
