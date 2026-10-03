import { useId, useState } from 'react'
import { friendlyError } from '#/components/feedback'
import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import { Label } from '#/components/ui/label'
import type { AvatarSource, Profile, ProfilePatch } from '#/lib/api'
import { AVATAR_EMOJI_CHOICES, resolveAvatar } from '#/lib/profile/avatar'
import { DISPLAY_NAME_MAX, validateDisplayName } from '#/lib/profile/identity'
import { useIdentity } from '#/lib/profile/useIdentity'
import { useUpdateProfile } from '#/lib/profile/useUpdateProfile'
import { cn } from '#/lib/utils'
import Avatar from './Avatar'

type Props = {
  me: Profile
  disabled?: boolean
  /** Called after a successful save (e.g. close the dialog). */
  onSaved?: () => void
  onCancel?: () => void
}

/** Edit name and avatar. One form for the profile dialog and the account page. */
export default function ProfileEditForm({
  me,
  disabled,
  onSaved,
  onCancel,
}: Props) {
  const nameId = useId()
  const identity = useIdentity()
  const save = useUpdateProfile()
  const [name, setName] = useState(me.display_name)
  const [source, setSource] = useState<AvatarSource>(
    me.avatar_source ?? 'photo',
  )
  const [emoji, setEmoji] = useState(me.avatar_emoji)
  const photoUrl = identity?.photoUrl
  // Without a Google photo there is nothing to choose between: the emoji is the avatar.
  const effectiveSource: AvatarSource = photoUrl ? source : 'emoji'

  const check = validateDisplayName(name)
  const patch: ProfilePatch = {}
  if (check.ok && check.value !== me.display_name)
    patch.display_name = check.value
  if (emoji !== me.avatar_emoji) patch.avatar_emoji = emoji
  if (effectiveSource !== (me.avatar_source ?? 'photo'))
    patch.avatar_source = effectiveSource
  const dirty = Object.keys(patch).length > 0
  const preview = resolveAvatar({
    source: effectiveSource,
    photoUrl,
    emoji,
    name: check.ok ? check.value : name,
  })

  return (
    <form
      className="space-y-5 text-left"
      onSubmit={(e) => {
        e.preventDefault()
        if (!check.ok || !dirty || disabled) return
        save.mutate(patch, { onSuccess: onSaved })
      }}
    >
      <fieldset
        disabled={disabled || save.isPending}
        className="space-y-5 border-0 p-0"
      >
        <div className="flex items-center gap-4">
          <span className="size-16 shrink-0 text-3xl" aria-hidden>
            <Avatar view={preview} />
          </span>
          <div className="min-w-0 flex-1 space-y-1">
            <Label htmlFor={nameId} className="block text-sm font-semibold">
              Display name
            </Label>
            <Input
              id={nameId}
              value={name}
              maxLength={DISPLAY_NAME_MAX * 2}
              autoComplete="nickname"
              aria-invalid={!check.ok}
              aria-describedby={`${nameId}-hint`}
              onChange={(e) => {
                setName(e.target.value)
                save.reset()
              }}
            />
            <p
              id={`${nameId}-hint`}
              className={cn(
                'text-xs',
                check.ok ? 'text-muted-foreground' : 'text-pink',
              )}
              role={check.ok ? undefined : 'alert'}
            >
              {check.ok
                ? 'Shown to you around the app. Up to 40 characters.'
                : check.reason}
            </p>
          </div>
        </div>

        {photoUrl && (
          <div
            role="radiogroup"
            aria-label="Avatar type"
            className="flex gap-2"
          >
            {(['photo', 'emoji'] as const).map((value) => (
              <Button
                key={value}
                type="button"
                role="radio"
                aria-checked={effectiveSource === value}
                variant="outline"
                size="sm"
                className={cn(
                  effectiveSource === value &&
                    'border-primary bg-primary/20 text-foreground',
                )}
                onClick={() => setSource(value)}
              >
                {value === 'photo' ? 'Use my photo' : 'Use an emoji'}
              </Button>
            ))}
          </div>
        )}

        {effectiveSource === 'emoji' && (
          <div>
            <p className="mb-2 text-sm font-semibold" id={`${nameId}-emoji`}>
              Pick an emoji
            </p>
            <div
              role="radiogroup"
              aria-labelledby={`${nameId}-emoji`}
              className="grid grid-cols-6 gap-1.5 sm:grid-cols-8"
            >
              {AVATAR_EMOJI_CHOICES.map((choice) => (
                <button
                  key={choice}
                  type="button"
                  role="radio"
                  aria-checked={emoji === choice}
                  aria-label={choice}
                  onClick={() => setEmoji(choice)}
                  className={cn(
                    'grid aspect-square min-h-11 place-items-center rounded-xl border text-xl outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50',
                    emoji === choice
                      ? 'border-primary bg-primary/20'
                      : 'border-transparent',
                  )}
                >
                  {choice}
                </button>
              ))}
            </div>
          </div>
        )}
      </fieldset>

      {save.isError && (
        <p role="alert" className="text-sm text-pink">
          {friendlyError(save.error)}
        </p>
      )}
      <div className="flex justify-end gap-2">
        {onCancel && (
          <Button type="button" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        )}
        <Button
          type="submit"
          disabled={!check.ok || !dirty || disabled || save.isPending}
        >
          {save.isPending ? 'Saving…' : 'Save changes'}
        </Button>
      </div>
    </form>
  )
}
