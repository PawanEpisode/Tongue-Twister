import { useEffect, useRef } from 'react'
import type { KeyboardEvent } from 'react'
import { ScrollRow, revealInScroller } from '#/components/ui/scroll-row'

export type ModeKey = 'read' | 'speak' | 'train' | 'record'

const MODES: { key: ModeKey; label: string; built: boolean }[] = [
  { key: 'read', label: 'Read along', built: true },
  { key: 'speak', label: 'Speak & score', built: true },
  { key: 'train', label: 'Train', built: true },
  { key: 'record', label: 'Record', built: true },
]
export const MODE_LABEL = Object.fromEntries(
  MODES.map((m) => [m.key, m.label]),
) as Record<ModeKey, string>
/** Modes that exist in this build (feature flags may still switch some off). */
export const BUILT_MODES = MODES.filter((m) => m.built).map((m) => m.key)

/** Accessible tablist (roving tabindex + arrow keys). Unbuilt modes are visible but disabled. */
export default function ModeSwitcher({
  mode,
  enabled,
  onChange,
}: {
  mode: ModeKey
  /** Modes the user may use right now (built and flagged on). */
  enabled: ModeKey[]
  onChange: (m: ModeKey) => void
}) {
  const usable = MODES.filter((m) => enabled.includes(m.key))
  const list = useRef<HTMLDivElement>(null)
  useEffect(() => {
    revealInScroller(list.current, '[aria-selected="true"]')
  }, [mode])
  const onKeyDown = (e: KeyboardEvent) => {
    const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0
    if (!step) return
    e.preventDefault()
    const at = usable.findIndex((m) => m.key === mode)
    onChange(usable[(at + step + usable.length) % usable.length].key)
  }
  return (
    <ScrollRow className="mx-auto mb-8 max-w-full lg:w-max flex justify-center">
      <div
        ref={list}
        role="tablist"
        aria-label="Practice mode"
        onKeyDown={onKeyDown}
        className="glass inline-flex rounded-full p-2 sm:p-1.5"
      >
        {MODES.map((m) => {
          const active = m.key === mode
          return (
            <button
              key={m.key}
              role="tab"
              id={`tab-${m.key}`}
              aria-selected={active}
              aria-controls="practice-stage"
              tabIndex={active ? 0 : -1}
              disabled={!enabled.includes(m.key)}
              onClick={() => onChange(m.key)}
              className={`whitespace-nowrap rounded-full px-3 py-2 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40 pointer-coarse:min-h-11 sm:px-4 ${active ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}
            >
              {m.label}
              {!m.built && (
                <span className="ml-1.5 text-[10px] uppercase tracking-wide">
                  Soon
                </span>
              )}
            </button>
          )
        })}
      </div>
    </ScrollRow>
  )
}
