import { Loader2, ShieldCheck } from 'lucide-react'
import { useState } from 'react'
import { Button } from '#/components/ui/button'
import type { AccentLang } from '#/lib/api'
import { ACCENTS } from '#/lib/speak/accurate'
import type {
  AccurateEngine,
  EngineStatus,
} from '#/lib/speak/engine/runtime/engine'

const mb = (bytes: number) => Math.max(1, Math.round(bytes / 1_048_576))

/**
 * The opt-in for Accurate mode. Silent when the device or server cannot offer it (no nagging, no dead buttons);
 * otherwise it says what it costs (a one-time download), shows progress, and can be switched off again.
 */
export default function AccurateModePrompt({
  engine,
  status,
  accent,
  onAccent,
}: {
  engine: AccurateEngine | null
  status: EngineStatus
  accent: AccentLang
  onAccent: (a: AccentLang) => void
}) {
  const [asking, setAsking] = useState(false)
  if (!engine) return null

  const shell =
    'mx-auto mt-6 max-w-md rounded-2xl border border-border/60 bg-card/40 p-4 text-left text-sm'

  if (status.state === 'idle')
    return (
      <section className={shell} aria-label="Accurate mode">
        <p className="flex items-start gap-2 font-semibold">
          <ShieldCheck
            className="mt-0.5 size-4 shrink-0 text-brand"
            aria-hidden
          />
          Accurate mode: hear exactly which sounds slipped
        </p>
        <p className="mt-1 text-muted-foreground">
          Your voice is analysed on this device.{' '}
          {status.cached
            ? 'The model is already downloaded.'
            : `One-time download, about ${mb(status.sizeBytes)} MB.`}
        </p>
        {asking ? (
          <div role="alert" className="mt-3">
            <p>
              You’re on a metered connection. Download {mb(status.sizeBytes)} MB
              anyway?
            </p>
            <div className="mt-2 flex gap-2">
              <Button
                size="sm"
                onClick={() => void engine.enable({ consent: true })}
              >
                Download
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setAsking(false)}
              >
                Not now
              </Button>
            </div>
          </div>
        ) : (
          <Button
            className="mt-3"
            size="sm"
            onClick={async () => {
              if ((await engine.enable()) === 'consent_needed') setAsking(true)
            }}
          >
            Turn on Accurate mode
          </Button>
        )}
      </section>
    )

  if (status.state === 'downloading')
    return (
      <section className={shell} aria-label="Accurate mode">
        <p className="font-semibold">Downloading the speech model…</p>
        <div
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round((status.loaded / status.total) * 100)}
          className="mt-2 h-1.5 overflow-hidden rounded-full bg-card"
        >
          <div
            className="h-full bg-primary"
            style={{ width: `${(status.loaded / status.total) * 100}%` }}
          />
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          {mb(status.loaded)} of {mb(status.total)} MB. You can keep practising
          meanwhile.
        </p>
        <Button
          className="mt-2"
          size="sm"
          variant="ghost"
          onClick={() => engine.disable()}
        >
          Cancel
        </Button>
      </section>
    )

  if (status.state === 'starting')
    return (
      <section className={shell} aria-label="Accurate mode">
        <p role="status" className="flex items-center gap-2 font-semibold">
          <Loader2
            className="size-4 animate-spin motion-reduce:animate-none"
            aria-hidden
          />
          {status.step === 'warming'
            ? 'Checking your device is fast enough…'
            : 'Getting Accurate mode ready…'}
        </p>
      </section>
    )

  if (status.state === 'error')
    return (
      <section className={shell} aria-label="Accurate mode">
        <p role="alert" className="font-semibold">
          {status.message}
        </p>
        <div className="mt-2 flex gap-2">
          {status.retryable && (
            <Button
              size="sm"
              onClick={() => void engine.enable({ consent: true })}
            >
              Try again
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={() => engine.disable()}>
            Stay on basic scoring
          </Button>
        </div>
      </section>
    )

  if (status.state === 'ready')
    return (
      <section className={shell} aria-label="Accurate mode">
        <p className="flex items-center gap-2 font-semibold">
          <ShieldCheck className="size-4 text-lime" aria-hidden />
          Accurate mode is on
        </p>
        <label className="mt-2 flex items-center gap-2 text-muted-foreground">
          Accent that counts as right
          <select
            value={accent}
            onChange={(e) => onAccent(e.target.value as AccentLang)}
            className="rounded-lg border border-border bg-background px-2 py-1 text-foreground"
          >
            {ACCENTS.map((a) => (
              <option key={a.value} value={a.value}>
                {a.label}
              </option>
            ))}
          </select>
        </label>
        <Button
          className="mt-2"
          size="sm"
          variant="ghost"
          onClick={() => engine.disable()}
        >
          Turn off
        </Button>
      </section>
    )

  return null
}
