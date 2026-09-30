import { ApiError } from './api'

/** Why a take couldn't be saved right now — worded for the cause, never a blanket "offline". */
export function unsavedReason(
  err: unknown,
  online: boolean = typeof navigator === 'undefined' || navigator.onLine,
): string {
  if (!online)
    return 'You’re offline — saved on this device and it will count once you’re back online.'
  if (err instanceof ApiError) {
    if (err.status === 401 || err.status === 403)
      return 'Your sign-in needs refreshing — sign in again. This attempt is saved on this device and will count afterwards.'
    if (err.status === 429)
      return 'Too many attempts at once — saved on this device and it will count shortly.'
  }
  return 'We couldn’t reach the server — saved on this device and it will count once it’s back.'
}
