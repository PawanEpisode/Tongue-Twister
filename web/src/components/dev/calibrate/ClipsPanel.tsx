import { Download, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Button } from '#/components/ui/button'
import { SCENARIOS } from '#/lib/calibrate/clip'
import type { GoldClip } from '#/lib/calibrate/clip'
import { groupBySlug } from '#/lib/calibrate/coverage'
import { SCENARIO_COPY } from '#/components/dev/calibrate/RecorderStage'

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <div className="rounded-xl bg-background/60 px-3 py-2 text-center">
      <p className="font-display text-xl font-bold tabular-nums">{value}</p>
      <p className="text-[11px] text-muted-foreground">{label}</p>
    </div>
  )
}

/** The session's kept clips: how much is covered, the download, and a per-twister list you can prune. */
export default function ClipsPanel({
  clips,
  onRemove,
  onClear,
  onDownload,
}: {
  clips: GoldClip[]
  onRemove: (id: string) => void
  onClear: () => void
  onDownload: () => void
}) {
  const [confirm, setConfirm] = useState(false)
  const groups = groupBySlug(clips)
  const max = Math.max(
    1,
    ...SCENARIOS.map((s) => clips.filter((c) => c.scenario === s).length),
  )

  return (
    <section
      aria-label="Clips"
      className="space-y-4 rounded-2xl border border-border/60 bg-card/40 p-4"
    >
      <div className="flex items-baseline justify-between">
        <h2 className="font-display text-lg font-bold">
          Kept clips{' '}
          <span className="tabular-nums text-muted-foreground">
            ({clips.length})
          </span>
        </h2>
      </div>

      {clips.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border px-3 py-6 text-center text-sm text-muted-foreground">
          Nothing kept yet. Record a take and press Keep.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-2">
            <Stat value={clips.length} label="clips" />
            <Stat
              value={new Set(clips.map((c) => c.speaker.id)).size}
              label="speakers"
            />
            <Stat
              value={new Set(clips.map((c) => c.twister.slug)).size}
              label="twisters"
            />
          </div>

          <ul className="space-y-1.5" aria-label="Clips by scenario">
            {SCENARIOS.map((s) => {
              const n = clips.filter((c) => c.scenario === s).length
              return (
                <li key={s} className="flex items-center gap-2 text-xs">
                  <span className="w-12 text-muted-foreground">
                    {SCENARIO_COPY[s].label}
                  </span>
                  <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-background/60">
                    <span
                      className="block h-full rounded-full bg-primary"
                      style={{ width: `${(n / max) * 100}%` }}
                    />
                  </span>
                  <span className="w-5 text-right tabular-nums">{n}</span>
                </li>
              )
            })}
          </ul>

          <div className="flex items-center gap-2">
            <Button className="flex-1" onClick={onDownload}>
              <Download className="mr-1.5 size-4" aria-hidden />
              Download gold set
            </Button>
            {confirm ? (
              <>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => {
                    onClear()
                    setConfirm(false)
                  }}
                >
                  Delete all
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setConfirm(false)}
                >
                  Cancel
                </Button>
              </>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setConfirm(true)}
              >
                Clear all
              </Button>
            )}
          </div>

          <ul className="max-h-72 space-y-2 overflow-y-auto pr-1">
            {groups.map((g) => (
              <li key={g.slug} className="rounded-xl bg-background/50 p-2.5">
                <p className="truncate font-mono text-xs text-muted-foreground">
                  {g.slug}
                </p>
                <ul className="mt-1 divide-y divide-border/40">
                  {g.clips.map((c) => (
                    <li
                      key={c.id}
                      className="flex items-center justify-between gap-2 py-1 text-sm"
                    >
                      <span className="min-w-0 truncate">
                        <span className="mr-2 rounded-full bg-muted px-2 py-0.5 text-[11px]">
                          {SCENARIO_COPY[c.scenario].label}
                        </span>
                        {c.speaker.id}
                        <span className="ml-2 text-xs text-muted-foreground">
                          {(c.duration_ms / 1000).toFixed(1)}s
                        </span>
                      </span>
                      <button
                        type="button"
                        aria-label={`Remove ${c.id}`}
                        onClick={() => onRemove(c.id)}
                        className="rounded-lg p-1 text-muted-foreground outline-none hover:text-destructive focus-visible:ring-2 focus-visible:ring-ring/50"
                      >
                        <Trash2 className="size-4" aria-hidden />
                      </button>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  )
}
