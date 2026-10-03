import type { Note } from '#/lib/authFlow'

/** The one place a form's error / info message is drawn, so every auth screen reads and announces alike. */
export function AuthNote({ note }: { note: Note | null }) {
  if (!note) return null
  const error = note.kind === 'error'
  return (
    <p
      role={error ? 'alert' : 'status'}
      className={
        error
          ? 'rounded-xl bg-destructive/10 px-3 py-2 text-sm text-destructive'
          : 'rounded-xl bg-lime/10 px-3 py-2 text-sm text-lime'
      }
    >
      {note.text}
    </p>
  )
}
