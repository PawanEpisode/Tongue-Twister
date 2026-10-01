import { useId, useState } from 'react'
import { Input } from '#/components/ui/input'
import { Label } from '#/components/ui/label'
import { FEEDBACK_COMMENT_MAX } from '#/lib/api'
import type { WordFeedback as Feedback } from '#/lib/api'

export type FeedbackHandler = (
  targetIndex: number,
  feedback: Feedback,
) => Promise<void>

/** "Was this fair?" — agree, or say you said it right, with an optional short note. */
export default function WordFeedback({
  onSend,
}: {
  onSend: (feedback: Feedback) => Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const [note, setNote] = useState('')
  const noteId = useId()
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'failed'>(
    'idle',
  )
  const send = async (judged_correct: boolean) => {
    setState('sending')
    try {
      await onSend({ judged_correct, comment: note.trim() || undefined })
      setState('sent')
    } catch {
      setState('failed')
    }
  }
  if (state === 'sent')
    return (
      <p className="mt-1 text-xs text-muted-foreground">
        Thanks for the feedback!
      </p>
    )
  if (!open)
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-1 text-xs text-muted-foreground underline underline-offset-2"
      >
        Was this fair?
      </button>
    )
  const busy = state === 'sending'
  return (
    <div className="mt-2 space-y-2">
      <div className="block text-xs text-muted-foreground">
        <Label
          htmlFor={noteId}
          className="text-xs font-normal text-muted-foreground"
        >
          Add a note (optional)
        </Label>
        <Input
          id={noteId}
          value={note}
          maxLength={FEEDBACK_COMMENT_MAX}
          onChange={(e) => setNote(e.target.value)}
          className="mt-1 px-2 py-1 text-sm"
        />
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => void send(true)} // the verdict was right
          className="rounded-full border border-border px-2.5 py-1 text-xs hover:bg-card disabled:opacity-60"
        >
          Fair
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void send(false)}
          className="rounded-full border border-border px-2.5 py-1 text-xs hover:bg-card disabled:opacity-60"
        >
          I said it right
        </button>
      </div>
      {state === 'failed' && (
        <p role="alert" className="text-xs text-pink">
          Couldn’t send — try again.
        </p>
      )}
    </div>
  )
}
