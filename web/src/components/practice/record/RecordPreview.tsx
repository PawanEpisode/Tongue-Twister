import { ArrowLeft, Circle, Sun, UserRound } from 'lucide-react'
import { useRef } from 'react'
import type { ReactNode } from 'react'
import { Button } from '#/components/ui/button'
import { LIGHTING_COPY } from '#/lib/record/hints'
import { cornerBubble } from '#/lib/record/layouts/geometry'
import type { Session } from '#/lib/record/session'
import type { RecordSettings } from '#/lib/record/settings'
import type { BubbleState } from '#/lib/record/layouts/types'
import LevelMeter from './LevelMeter'
import PreviewSurface, { BUBBLE_PRESETS } from './PreviewSurface'
import { useCameraHints } from './useCameraHints'

const CORNERS = [
  ['tl', 'Top left'],
  ['tr', 'Top right'],
  ['bl', 'Bottom left'],
  ['br', 'Bottom right'],
] as const

/** Step 2: see exactly what will be recorded, check sound and light, then press Record. */
export default function RecordPreview({
  session,
  settings,
  onBubble,
  onRecord,
  onBack,
  locked,
  overlay,
  countdownActive,
}: {
  session: Session
  settings: RecordSettings
  onBubble: (b: BubbleState) => void
  onRecord: () => void
  onBack: () => void
  locked: boolean
  /** Text shown over the picture (used by the region layout's stage). */
  overlay?: ReactNode
  countdownActive: boolean
}) {
  const host = useRef<HTMLDivElement>(null)
  const { lighting, noFace } = useCameraHints(
    host,
    session.hasCamera && !countdownActive,
  )
  const bubble = session.layout.id === 'screen_bubble' && session.hasScreen

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div ref={host}>
        <PreviewSurface
          session={session}
          settings={settings}
          onBubble={onBubble}
          editableBubble={bubble}
        >
          {overlay}
        </PreviewSurface>
      </div>

      <div className="mx-auto max-w-md space-y-3">
        {session.hasMic ? (
          <div className="text-left">
            <span className="mb-1 block text-xs text-muted-foreground">
              Say something — the bar should move.
            </span>
            <LevelMeter level={session.level} />
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            Recording without sound.
          </p>
        )}
        {!session.hasCamera && !session.layout.needs.region && (
          <p className="text-sm text-muted-foreground">
            Audio-only: your voice is recorded over a sound-wave picture.
          </p>
        )}
        {session.acquired.downgraded && (
          <p role="status" className="text-xs text-muted-foreground">
            Your camera couldn’t do that quality, so we’re using a lower one.
          </p>
        )}
        <div aria-live="polite" className="space-y-1 text-sm">
          {lighting !== 'ok' && (
            <p className="flex items-start gap-2 text-left text-muted-foreground">
              <Sun className="mt-0.5 size-4 shrink-0 text-brand" aria-hidden />
              {LIGHTING_COPY[lighting]}
            </p>
          )}
          {noFace && (
            <p className="flex items-start gap-2 text-left text-muted-foreground">
              <UserRound
                className="mt-0.5 size-4 shrink-0 text-brand"
                aria-hidden
              />
              We can’t see your face — move into the frame.
            </p>
          )}
          <p className="text-left text-xs text-muted-foreground">
            Headphones help avoid echo.
          </p>
        </div>

        {bubble && (
          <fieldset className="text-left">
            <legend className="mb-1 text-xs font-semibold">
              Camera bubble
            </legend>
            <div className="flex flex-wrap gap-2">
              {BUBBLE_PRESETS.map(([label, size]) => (
                <Button
                  key={label}
                  variant="outline"
                  size="sm"
                  aria-pressed={Math.abs(settings.bubble.size - size) < 0.02}
                  aria-label={`Bubble size ${label === 'S' ? 'small' : label === 'M' ? 'medium' : 'large'}`}
                  onClick={() => onBubble({ ...settings.bubble, size })}
                >
                  {label}
                </Button>
              ))}
              {CORNERS.map(([corner, label]) => (
                <Button
                  key={corner}
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    onBubble(cornerBubble(corner, settings.bubble.size))
                  }
                >
                  {label}
                </Button>
              ))}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              You can also drag the bubble in the picture.
            </p>
          </fieldset>
        )}
      </div>

      {locked && (
        <p role="status" className="text-sm text-pink">
          Practice is active in another tab — finish it there first.
        </p>
      )}
      <div className="flex flex-wrap justify-center gap-3">
        <Button variant="outline" onClick={onBack}>
          <ArrowLeft className="mr-2 size-4" aria-hidden />
          Change setup
        </Button>
        <Button
          size="lg"
          disabled={locked}
          onClick={onRecord}
          className="bg-pink text-pink-foreground"
        >
          <Circle className="mr-2 size-4 fill-current" aria-hidden />
          Record
        </Button>
      </div>
    </div>
  )
}
