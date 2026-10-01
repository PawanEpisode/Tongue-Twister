/**
 * New accounts start on UTC, which would cut a learner's day at the wrong hour. Once per device, if the
 * profile is still on UTC and the browser knows better, the browser's zone is sent. Returns the zone to
 * send, or null when there's nothing to do.
 */
export function timezoneToSync(
  profileZone: string | undefined,
  browserZone: string | undefined,
  alreadySynced: boolean,
): string | null {
  if (alreadySynced || !profileZone || !browserZone) return null
  if (profileZone !== 'UTC') return null // the user (or an earlier device) already chose
  return browserZone === 'UTC' ? null : browserZone
}

export const browserTimeZone = (): string | undefined => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone
  } catch {
    return undefined
  }
}
