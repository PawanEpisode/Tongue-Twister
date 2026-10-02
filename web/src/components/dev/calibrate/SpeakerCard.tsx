import { ChevronDown, User } from 'lucide-react'
import { useState } from 'react'
import type { AccentLang } from '#/lib/api'
import { AGE_BANDS, DEVICE_CLASSES } from '#/lib/calibrate/clip'
import type { Speaker } from '#/lib/calibrate/clip'
import { ACCENTS } from '#/lib/speak/accurate'
import { cn } from '#/lib/utils'

const control =
  'w-full rounded-xl border border-input bg-card px-3 py-2 text-sm text-foreground outline-none focus:border-primary focus-visible:ring-2 focus-visible:ring-ring/50'

function Field({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
      {label}
      {children}
    </label>
  )
}

/** Who is speaking. Collapsed to a one-line summary once it is filled in; consent is a clear switch, not a footnote. */
export default function SpeakerCard({
  speaker,
  onChange,
  consent,
  onConsent,
}: {
  speaker: Speaker
  onChange: (s: Speaker) => void
  consent: boolean
  onConsent: (v: boolean) => void
}) {
  const [open, setOpen] = useState(true)
  const accent = ACCENTS.find((a) => a.value === speaker.accent)?.label
  return (
    <section
      aria-label="Speaker"
      className="rounded-2xl border border-border/60 bg-card/40"
    >
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-3 rounded-2xl p-4 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-primary/20 text-brand">
          <User className="size-4" aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Speaker
          </span>
          <span className="block truncate text-sm font-semibold">
            {speaker.id || 'No id'} · {accent} · {speaker.age_band} ·{' '}
            {speaker.device_class}
          </span>
        </span>
        <ChevronDown
          className={cn(
            'size-4 shrink-0 text-muted-foreground transition-transform',
            open && 'rotate-180',
          )}
          aria-hidden
        />
      </button>

      {open && (
        <div className="space-y-3 border-t border-border/60 p-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Speaker id (no names)">
              <input
                className={control}
                value={speaker.id}
                onChange={(e) =>
                  onChange({ ...speaker, id: e.target.value.trim() })
                }
              />
            </Field>
            <Field label="Age band">
              <select
                className={control}
                value={speaker.age_band}
                onChange={(e) =>
                  onChange({
                    ...speaker,
                    age_band: e.target.value as Speaker['age_band'],
                  })
                }
              >
                {AGE_BANDS.map((b) => (
                  <option key={b}>{b}</option>
                ))}
              </select>
            </Field>
            <Field label="Accent">
              <select
                className={control}
                value={speaker.accent}
                onChange={(e) =>
                  onChange({ ...speaker, accent: e.target.value as AccentLang })
                }
              >
                {ACCENTS.map((a) => (
                  <option key={a.value} value={a.value}>
                    {a.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Device">
              <select
                className={control}
                value={speaker.device_class}
                onChange={(e) =>
                  onChange({
                    ...speaker,
                    device_class: e.target.value as Speaker['device_class'],
                  })
                }
              >
                {DEVICE_CLASSES.map((d) => (
                  <option key={d}>{d}</option>
                ))}
              </select>
            </Field>
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="size-4 accent-[var(--primary)]"
              checked={speaker.native}
              onChange={(e) =>
                onChange({ ...speaker, native: e.target.checked })
              }
            />
            Native English speaker
          </label>

          <label
            className={cn(
              'flex cursor-pointer items-start gap-3 rounded-xl border p-3 text-sm transition-colors',
              consent
                ? 'border-lime/40 bg-lime/10'
                : 'border-border bg-background/40',
            )}
          >
            <input
              type="checkbox"
              className="mt-0.5 size-4 accent-[var(--primary)]"
              checked={consent}
              onChange={(e) => {
                onConsent(e.target.checked)
                if (e.target.checked) setOpen(false)
              }}
            />
            <span>
              This speaker agreed to be recorded and to keep the resulting
              posteriors for calibration.
            </span>
          </label>
        </div>
      )}
    </section>
  )
}
