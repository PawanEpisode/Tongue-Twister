import { Gauge, Loader2 } from 'lucide-react'
import { Button } from '#/components/ui/button'
import type { BenchmarkResult } from '#/lib/calibrate/benchmark'

export default function BenchmarkPanel({
  result,
  running,
  disabled,
  onRun,
}: {
  result: BenchmarkResult | null
  running: boolean
  disabled: boolean
  onRun: () => void
}) {
  return (
    <details className="group rounded-2xl border border-border/60 bg-card/40">
      <summary className="flex cursor-pointer list-none items-center gap-3 rounded-2xl p-4 outline-none focus-visible:ring-2 focus-visible:ring-ring/50">
        <Gauge className="size-4 text-muted-foreground" aria-hidden />
        <span className="flex-1 font-display text-lg font-bold">
          Device benchmark
        </span>
        <span className="text-xs text-muted-foreground group-open:hidden">
          Show
        </span>
      </summary>
      <div className="space-y-3 border-t border-border/60 p-4">
        <p className="text-sm text-muted-foreground">
          Times the speech model on this device. Run it once per device you
          record on.
        </p>
        <Button size="sm" onClick={onRun} disabled={disabled || running}>
          {running && (
            <Loader2
              className="mr-1.5 size-3.5 animate-spin motion-reduce:animate-none"
              aria-hidden
            />
          )}
          {running ? 'Running…' : result ? 'Run again' : 'Run benchmark'}
        </Button>
        {disabled && !running && (
          <p className="text-xs text-muted-foreground">
            Turn on Accurate mode first.
          </p>
        )}
        {result && (
          <pre className="max-h-64 overflow-auto rounded-xl bg-background/60 p-3 text-xs">
            {JSON.stringify(result, null, 2)}
          </pre>
        )}
      </div>
    </details>
  )
}
