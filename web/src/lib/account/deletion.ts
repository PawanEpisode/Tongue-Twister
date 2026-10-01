import type { Profile } from '#/lib/api'

/** What the user types to confirm; the API checks the same word (`DELETE /me/ {"confirm":"DELETE"}`). */
export const DELETE_CONFIRM_WORD = 'DELETE'
/** Mirrors the API's `ACCOUNT_DELETION_GRACE_DAYS`; only used for the wording before a request exists. */
export const DELETION_GRACE_DAYS = 30

/** Exact match on purpose: the word is a speed bump, not a password. Surrounding spaces are forgiven. */
export const isDeleteConfirmed = (typed: string): boolean =>
  typed.trim() === DELETE_CONFIRM_WORD

export type DeletionState =
  { pending: false } | { pending: true; scheduledFor: string }

export function deletionState(
  me: Pick<Profile, 'deletion_scheduled_for'> | undefined | null,
): DeletionState {
  const scheduledFor = me?.deletion_scheduled_for
  return scheduledFor ? { pending: true, scheduledFor } : { pending: false }
}

/** "30 October 2026" in the reader's locale and time zone (the purge date is an instant, not a calendar day). */
export function formatDeletionDate(iso: string, locale?: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return new Intl.DateTimeFormat(locale, { dateStyle: 'long' }).format(date)
}
