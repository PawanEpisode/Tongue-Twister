import type { Profile } from '#/lib/api'

/** The state of one saved setting, for the `aria-live` note beside it. */
export type SaveStatus = 'idle' | 'saving' | 'saved' | 'failed'

/** The profile with a patch applied, as shown before the server has answered. Pure; never mutates. */
export const applyPatch = <TPatch extends Partial<Profile>>(
  profile: Profile,
  patch: TPatch,
): Profile => ({ ...profile, ...patch })

const STATUS_TEXT: Record<SaveStatus, string> = {
  idle: '',
  saving: 'Saving…',
  saved: 'Saved.',
  failed: 'Couldn’t save that, so it was put back. Try again.',
}
export const saveStatusText = (status: SaveStatus): string =>
  STATUS_TEXT[status]
