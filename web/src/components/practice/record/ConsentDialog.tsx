import { useState } from 'react'
import { Button } from '#/components/ui/button'
import { Dialog } from '#/components/ui/dialog'
import type { AgeBand } from '#/lib/api'

type Age = Exclude<AgeBand, 'unknown'>

export type ConsentCopy = {
  title: string
  description: string
  agree: string
  confirm: string
  confirming: string
}
const RECORDING_COPY: ConsentCopy = {
  title: 'Save this recording to your account',
  description:
    'It is stored privately. Only you can see it unless you make a share link.',
  agree:
    'I agree that Twister may store this video and its audio for me, and delete it when the storage time is up or when I delete it.',
  confirm: 'Agree and save',
  confirming: 'Saving…',
}
/** Same dialog, different consent: processing the audio of a saved take to find mistakes. */
export const ANALYSIS_COPY: ConsentCopy = {
  title: 'Analyse this recording',
  description:
    'We process the audio of this recording on our servers to check what you said.',
  agree:
    'I agree that Twister may process the audio of this recording to analyse it, and keep the result with the recording.',
  confirm: 'Agree and analyse',
  confirming: 'Saving…',
}

/**
 * Before the first cloud save: are you 13 or older (only asked once) and do you agree to store this video.
 * Under-13s keep recordings on their device; nothing is uploaded and no consent is recorded for them.
 */
export default function ConsentDialog({
  open,
  askAge,
  busy,
  failed,
  onConfirm,
  onClose,
  copy = RECORDING_COPY,
}: {
  open: boolean
  askAge: boolean
  busy: boolean
  failed: boolean
  onConfirm: (age: Age | null) => void
  onClose: () => void
  copy?: ConsentCopy
}) {
  const [age, setAge] = useState<Age | null>(null)
  const [agreed, setAgreed] = useState(false)
  const minor = askAge && age === 'under13'
  const ready = minor || (agreed && (!askAge || age === '13plus'))

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={copy.title}
      description={copy.description}
    >
      <div className="space-y-4 text-left text-sm">
        {askAge && (
          <fieldset className="space-y-2">
            <legend className="mb-1 font-semibold">How old are you?</legend>
            {(
              [
                ['13plus', 'I am 13 or older'],
                ['under13', 'I am under 13'],
              ] as const
            ).map(([value, label]) => (
              <label key={value} className="flex items-center gap-2">
                <input
                  type="radio"
                  name="age-band"
                  checked={age === value}
                  onChange={() => setAge(value)}
                  className="size-4 accent-[var(--primary)]"
                />
                {label}
              </label>
            ))}
          </fieldset>
        )}
        {minor ? (
          <p role="status" className="text-muted-foreground">
            Recordings from accounts under 13 stay on this device. You can still
            download them.
          </p>
        ) : (
          <label className="flex items-start gap-2">
            <input
              type="checkbox"
              checked={agreed}
              onChange={(e) => setAgreed(e.target.checked)}
              className="mt-0.5 size-4 accent-[var(--primary)]"
            />
            <span>{copy.agree}</span>
          </label>
        )}
        {failed && (
          <p role="alert" className="text-pink">
            We couldn’t save your choice. Try again.
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            Not now
          </Button>
          <Button
            disabled={!ready || busy}
            onClick={() => onConfirm(askAge ? age : null)}
          >
            {minor
              ? 'Keep on this device'
              : busy
                ? copy.confirming
                : copy.confirm}
          </Button>
        </div>
      </div>
    </Dialog>
  )
}
