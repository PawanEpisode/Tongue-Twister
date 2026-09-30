import { useEffect, useId, useState } from 'react'
import { friendlyError } from '#/components/feedback'
import { Button } from '#/components/ui/button'
import { PUBLIC_NAME_MAX, validatePublicName } from '#/lib/publicName'
import { usePublicName } from '#/lib/record/useRecordings'
import { useMe } from '#/lib/useMe'

/**
 * The name shown on recordings you share. Blank means anonymous: the account name and e-mail are never used.
 * One component for every place that needs it (share dialog, recordings page).
 */
export default function PublicNameField() {
  const id = useId()
  const me = useMe().data
  const save = usePublicName()
  const saved = me?.public_name ?? ''
  const [draft, setDraft] = useState(saved)
  useEffect(() => setDraft(saved), [saved])

  if (!me) return null
  const check = validatePublicName(draft)
  const dirty = check.ok && check.value !== saved

  return (
    <form
      className="space-y-1 text-left text-sm"
      onSubmit={(e) => {
        e.preventDefault()
        if (check.ok && dirty) save.mutate(check.value)
      }}
    >
      <label htmlFor={id} className="block font-semibold">
        Name on shared recordings
      </label>
      <div className="flex gap-2">
        <input
          id={id}
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value)
            save.reset()
          }}
          placeholder="Anonymous"
          autoComplete="off"
          aria-invalid={!check.ok}
          aria-describedby={`${id}-hint`}
          className="min-w-0 flex-1 rounded-xl border border-input bg-card px-3 py-2"
        />
        <Button
          type="submit"
          variant="outline"
          disabled={!dirty || save.isPending}
        >
          {save.isPending ? 'Saving…' : 'Save'}
        </Button>
      </div>
      <p id={`${id}-hint`} className="text-xs text-muted-foreground">
        Shown on recordings you share. Leave it blank to stay anonymous. Up to{' '}
        {PUBLIC_NAME_MAX} characters.
      </p>
      {!check.ok && (
        <p role="alert" className="text-xs text-pink">
          {check.reason}
        </p>
      )}
      {save.isError && (
        <p role="alert" className="text-xs text-pink">
          {friendlyError(save.error)}
        </p>
      )}
      {save.isSuccess && !dirty && (
        <p role="status" className="text-xs text-lime">
          Saved.
        </p>
      )}
    </form>
  )
}
