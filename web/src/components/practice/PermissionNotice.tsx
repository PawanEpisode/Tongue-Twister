import type { MediaKind, PermissionState } from '#/lib/useMediaPermissions'

const LABEL: Record<MediaKind, string> = {
  microphone: 'microphone',
  camera: 'camera',
}

function copy(state: PermissionState, kind: MediaKind): string | null {
  const device = LABEL[kind]
  switch (state) {
    case 'denied':
      return `Twister can't use your ${device}. Click the 🔒 in the address bar → Site settings → ${kind === 'microphone' ? 'Microphone' : 'Camera'} → Allow, then try again.`
    case 'unavailable':
      return `No ${device} found. Plug one in, or practise with Read along instead.`
    case 'in_use':
      return `Another app is using your ${device}. Close it and try again.`
    case 'error':
      return `We couldn't start your ${device}. Try again, or use Read along.`
    default:
      return null // unknown / prompt / granted: nothing to explain
  }
}

/** Plain-language help for every way a device can be unusable, always with a way forward. */
export default function PermissionNotice({
  state,
  kind,
  onRetry,
  onReadAlong,
}: {
  state: PermissionState
  kind: MediaKind
  onRetry: () => void
  onReadAlong?: () => void
}) {
  const message = copy(state, kind)
  if (!message) return null
  return (
    <div
      role="alert"
      className="glass mx-auto mt-4 max-w-md rounded-2xl p-4 text-sm text-white/80"
    >
      <p>{message}</p>
      <div className="mt-3 flex justify-center gap-2">
        <button
          className="rounded-xl border border-line px-3 py-1.5 font-semibold hover:border-brand"
          onClick={onRetry}
        >
          Try again
        </button>
        {onReadAlong && (
          <button
            className="rounded-xl bg-brand px-3 py-1.5 font-semibold"
            onClick={onReadAlong}
          >
            Use Read along
          </button>
        )}
      </div>
    </div>
  )
}
