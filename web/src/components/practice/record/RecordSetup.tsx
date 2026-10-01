import { Camera, Mic, ShieldCheck } from 'lucide-react'
import { cloneElement, useEffect, useId, useState } from 'react'
import type { ReactElement } from 'react'
import PermissionNotice from '../PermissionNotice'
import { Button } from '#/components/ui/button'
import {
  Drawer,
  DrawerContent,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from '#/components/ui/drawer'
import { Checkbox } from '#/components/ui/checkbox'
import { Input } from '#/components/ui/input'
import { Label } from '#/components/ui/label'
import { SelectField } from '#/components/ui/select'
import type { Twister } from '#/lib/api'
import type { Capabilities } from '#/lib/record/capabilities'
import { supportFor } from '#/lib/record/capabilities'
import type { RecordError } from '#/lib/record/errors'
import { usesPacing, usesSpeech } from '#/lib/record/highlight'
import type { HighlightMode } from '#/lib/record/highlight'
import { getLayout, LAYOUT_LIST } from '#/lib/record/layouts'
import {
  estimateBytes,
  formatBytes,
  formatClock,
  storageHeadroom,
  videoBitrate,
} from '#/lib/record/quality'
import type { Resolution } from '#/lib/record/quality'
import type { RecordSettings, CountdownS } from '#/lib/record/settings'
import { listDevices } from '#/lib/record/sources'
import type { DeviceList } from '#/lib/record/sources'
import type { SessionOpenError } from '#/lib/record/session'
import type { PermissionState } from '#/lib/useMediaPermissions'
import { useMediaPermissions } from '#/lib/useMediaPermissions'
import LayoutPicker from './LayoutPicker'

const STATE_OF: Record<string, PermissionState> = {
  permission_denied: 'denied',
  device_missing: 'unavailable',
  device_busy: 'in_use',
}
const permissionState = (e: RecordError | null): PermissionState =>
  e ? (STATE_OF[e.class] ?? 'error') : 'unknown'

function Field({
  label,
  children,
  hint,
}: {
  label: string
  children: ReactElement<{ id?: string }>
  hint?: string
}) {
  const id = useId()
  return (
    <div className="text-left text-sm">
      <Label htmlFor={id} className="mb-1 block font-semibold">
        {label}
      </Label>
      {cloneElement(children, { id })}
      {hint && (
        <span className="mt-1 block text-xs text-muted-foreground">{hint}</span>
      )}
    </div>
  )
}

function Toggle({
  label,
  checked,
  onChange,
  disabled,
}: {
  label: string
  checked: boolean
  onChange: (v: boolean) => void
  disabled?: boolean
}) {
  const id = useId()
  return (
    <div className="flex items-center gap-2 text-left text-sm">
      <Checkbox
        id={id}
        checked={checked}
        disabled={disabled}
        onCheckedChange={(value) => onChange(value === true)}
      />
      <Label htmlFor={id} className="font-normal">
        {label}
      </Label>
    </div>
  )
}

/** Step 1: pick a layout, devices and options, then ask for the camera and microphone. */
export default function RecordSetup({
  twister,
  settings,
  update,
  caps,
  limitMs,
  speechSupported,
  busy,
  locked,
  openError,
  onStart,
  onRetry,
  onSwitchMode,
  dismissError,
}: {
  twister: Twister
  settings: RecordSettings
  update: (patch: Partial<RecordSettings>) => void
  caps: Capabilities
  limitMs: number
  speechSupported: boolean
  busy: boolean
  /** Another tab is practising. */
  locked: boolean
  openError: SessionOpenError | null
  onStart: (choices?: { audioOnly?: boolean; noMic?: boolean }) => void
  onRetry: () => void
  onSwitchMode: () => void
  dismissError: () => void
}) {
  const layout = getLayout(settings.layout)
  const camPerm = useMediaPermissions('camera')
  const micPerm = useMediaPermissions('microphone')
  const [devices, setDevices] = useState<DeviceList>({ cameras: [], mics: [] })
  const [free, setFree] = useState<number | null>(null)

  useEffect(() => {
    let live = true
    void listDevices(navigator.mediaDevices).then(
      (d) => live && setDevices(d),
      () => undefined,
    )
    return () => {
      live = false
    }
  }, [camPerm.state, micPerm.state])

  useEffect(() => {
    void navigator.storage?.estimate?.().then(
      (e) =>
        setFree(e.quota != null ? Math.max(0, e.quota - (e.usage ?? 0)) : null),
      () => undefined,
    )
  }, [])

  const size = layout.size(settings.resolution)
  const perMinute = estimateBytes(60_000, videoBitrate(size.width, size.height))
  const maxBytes = estimateBytes(limitMs, videoBitrate(size.width, size.height))
  const headroom = storageHeadroom(
    free == null ? undefined : { quota: free, usage: 0 },
    maxBytes,
  )
  const supported = supportFor(caps, layout.needs).ok
  const [settingsOpen, setSettingsOpen] = useState(false)
  useEffect(() => {
    if (supported) return
    const next = LAYOUT_LIST.find((item) => supportFor(caps, item.needs).ok)
    if (next) update({ layout: next.id })
  }, [supported, caps, update])
  const camErr = openError?.camera ?? null
  const micErr = openError?.mic ?? null
  const needsCamera = layout.needs.camera
  const pacing = usesPacing(settings.highlight)
  const speech = usesSpeech(settings.highlight)
  const summary = [
    layout.label,
    needsCamera && caps.platform !== 'desktop'
      ? settings.facing === 'environment'
        ? 'Back camera'
        : 'Front camera'
      : null,
    needsCamera
      ? settings.resolution === 'auto'
        ? 'Auto 720p'
        : settings.resolution
      : null,
    settings.countdownS === 0
      ? 'No countdown'
      : `${settings.countdownS}s countdown`,
  ]
    .filter((part) => part)
    .join(' · ')

  return (
    <div className="mx-auto max-w-2xl space-y-6 text-center">
      <div className="glass rounded-2xl p-5 text-left">
        <p className="text-xs font-medium text-muted-foreground">This take</p>
        <p className="mt-1 text-base font-semibold text-foreground">
          {summary}
        </p>
        <Button
          type="button"
          variant="outline"
          className="mt-4"
          onClick={() => setSettingsOpen(true)}
        >
          Layout & settings
        </Button>
      </div>
      <Drawer open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DrawerContent className="overflow-hidden">
          <DrawerHeader>
            <DrawerTitle className="text-center font-display text-xl font-bold">
              Layout & settings
            </DrawerTitle>
          </DrawerHeader>
          <div className="min-h-0 flex-1 space-y-8 overflow-y-auto px-4 pb-2 text-left">
            <section aria-labelledby="rec-layout">
              <h2
                id="rec-layout"
                className="mb-3 font-display text-lg font-bold"
              >
                Layout
              </h2>
              <LayoutPicker
                value={settings.layout}
                onChange={(id) => update({ layout: id })}
                caps={caps}
              />
              {layout.needs.screen && !layout.needs.region && (
                <p className="mt-2 text-xs text-muted-foreground">
                  Pick a window or tab in your browser’s sharing box. Close
                  private tabs first, and you can crop after recording.
                </p>
              )}
              {layout.needs.region && (
                <p className="mt-2 text-xs text-muted-foreground">
                  Your browser will ask to share this tab. Only the practice box
                  is recorded.
                </p>
              )}
            </section>

            <section
              aria-labelledby="rec-devices"
              className="grid gap-4 sm:grid-cols-2"
            >
              <h2 id="rec-devices" className="sr-only">
                Devices
              </h2>
              {needsCamera && (
                <SelectField
                  label="Camera"
                  value={settings.cameraId}
                  onValueChange={(cameraId) => update({ cameraId })}
                  options={[
                    { value: '', label: 'Default camera' },
                    ...devices.cameras.map((d) => ({
                      value: d.id,
                      label: d.label,
                    })),
                  ]}
                />
              )}
              <SelectField
                label="Microphone"
                value={settings.micId}
                onValueChange={(micId) => update({ micId })}
                options={[
                  { value: '', label: 'Default microphone' },
                  ...devices.mics.map((d) => ({ value: d.id, label: d.label })),
                ]}
              />
              {needsCamera && (
                <SelectField
                  label="Quality"
                  hint="Auto is 720p at 30 fps."
                  value={settings.resolution}
                  onValueChange={(resolution) =>
                    update({ resolution: resolution as Resolution })
                  }
                  options={[
                    { value: 'auto', label: 'Auto (720p)' },
                    { value: '720p', label: '720p' },
                    { value: '1080p', label: '1080p' },
                  ]}
                />
              )}
              {caps.platform !== 'desktop' && needsCamera && (
                <SelectField
                  label="Camera facing"
                  value={settings.facing}
                  onValueChange={(facing) =>
                    update({ facing: facing as 'user' | 'environment' })
                  }
                  options={[
                    { value: 'user', label: 'Front' },
                    { value: 'environment', label: 'Back' },
                  ]}
                />
              )}
            </section>

            <section
              aria-labelledby="rec-text"
              className="grid gap-4 sm:grid-cols-2"
            >
              <h2 id="rec-text" className="sr-only">
                Text and timing
              </h2>
              <SelectField
                label="Highlight the words"
                hint={
                  speechSupported
                    ? undefined
                    : 'Voice following isn’t supported in this browser.'
                }
                value={settings.highlight}
                onValueChange={(highlight) =>
                  update({ highlight: highlight as HighlightMode })
                }
                options={[
                  { value: 'pacing', label: 'Follow a pace (Read along)' },
                  {
                    value: 'speech',
                    label: 'Follow my voice (Speak & score)',
                    disabled: !speechSupported,
                  },
                  {
                    value: 'both',
                    label: 'Pace guide and my voice',
                    disabled: !speechSupported,
                  },
                ]}
              />
              {pacing && (
                <Field
                  label="Pace (words per minute)"
                  hint="Leave empty for automatic."
                >
                  <Input
                    type="number"
                    inputMode="numeric"
                    min={40}
                    max={300}
                    value={settings.wpm ?? ''}
                    placeholder="Auto"
                    onChange={(e) =>
                      update({
                        wpm:
                          e.target.value === '' ? null : Number(e.target.value),
                      })
                    }
                  />
                </Field>
              )}
              <SelectField
                label="Countdown"
                value={String(settings.countdownS)}
                onValueChange={(countdownS) =>
                  update({ countdownS: Number(countdownS) as CountdownS })
                }
                options={[
                  { value: '0', label: 'None' },
                  { value: '3', label: '3 seconds' },
                  { value: '5', label: '5 seconds' },
                ]}
              />
              <div className="space-y-2 self-end">
                <Toggle
                  label="Reduce echo"
                  checked={settings.echoCancellation}
                  onChange={(echoCancellation) => update({ echoCancellation })}
                />
                <Toggle
                  label="Reduce background noise"
                  checked={settings.noiseSuppression}
                  onChange={(noiseSuppression) => update({ noiseSuppression })}
                />
                {needsCamera && (
                  <Toggle
                    label="Mirror my preview"
                    checked={settings.mirrorPreview}
                    onChange={(mirrorPreview) => update({ mirrorPreview })}
                  />
                )}
                {needsCamera && (
                  <Toggle
                    label="Mirror the saved video too"
                    checked={settings.mirrorSaved}
                    onChange={(mirrorSaved) => update({ mirrorSaved })}
                  />
                )}
                {speech && (
                  <Toggle
                    label="Stop when I finish the twister"
                    checked={settings.autoStopOnFinish}
                    onChange={(autoStopOnFinish) =>
                      update({ autoStopOnFinish })
                    }
                  />
                )}
              </div>
            </section>
          </div>
          <DrawerFooter>
            <Button type="button" onClick={() => setSettingsOpen(false)}>
              Done
            </Button>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>

      <p className="flex items-start gap-2 rounded-xl bg-card/60 p-3 text-left text-sm text-muted-foreground">
        <ShieldCheck className="mt-0.5 size-4 shrink-0 text-lime" aria-hidden />
        Recordings stay on this device unless you save them to your account.
        They may capture people or screens around you.
      </p>
      <p className="text-xs text-muted-foreground" aria-live="polite">
        About {formatBytes(perMinute)} a minute · up to {formatBytes(maxBytes)}{' '}
        for a {formatClock(limitMs)} take
        {free != null && <> · {formatBytes(free)} free here</>}.
        {!headroom.ok && (
          <span className="ml-1 font-semibold text-pink">
            That’s not enough space — free some up or lower the quality.
          </span>
        )}
      </p>

      <div className="space-y-3 text-center">
        {camPerm.state === 'denied' && needsCamera && !camErr && (
          <PermissionNotice
            state="denied"
            kind="camera"
            onRetry={() => onStart()}
            onReadAlong={onSwitchMode}
          />
        )}
        {camErr && (
          <PermissionNotice
            state={permissionState(camErr)}
            kind="camera"
            onRetry={onRetry}
            onReadAlong={onSwitchMode}
          />
        )}
        {micErr && (
          <PermissionNotice
            state={permissionState(micErr)}
            kind="microphone"
            onRetry={onRetry}
            onReadAlong={onSwitchMode}
          />
        )}
        {camErr && !micErr && (
          <div
            role="group"
            aria-label="Other ways to continue"
            className="flex flex-wrap justify-center gap-2"
          >
            <Button
              variant="outline"
              onClick={() => onStart({ audioOnly: true })}
            >
              <Mic className="mr-2 size-4" aria-hidden />
              Record audio only
            </Button>
          </div>
        )}
        {micErr && !camErr && needsCamera && (
          <Button variant="outline" onClick={() => onStart({ noMic: true })}>
            <Camera className="mr-2 size-4" aria-hidden />
            Record without sound
          </Button>
        )}
        {!camErr && !micErr && openError && (
          <p role="alert" className="text-sm text-pink">
            {openError.error.title}. {openError.error.message}
          </p>
        )}
        {locked && (
          <p role="status" className="text-sm text-pink">
            Practice is active in another tab — finish it there first.
          </p>
        )}
        <Button
          size="lg"
          className="w-full sm:w-auto"
          disabled={busy || locked || !supported || !headroom.ok}
          onClick={() => {
            dismissError()
            onStart({})
          }}
        >
          <Camera className="mr-2 size-5" aria-hidden />
          {busy ? 'Getting ready…' : needsCamera ? 'Start camera' : 'Continue'}
        </Button>
        <p className="text-xs text-muted-foreground">
          Recording “
          {twister.text.length > 48
            ? `${twister.text.slice(0, 48)}…`
            : twister.text}
          ”
        </p>
      </div>
    </div>
  )
}
