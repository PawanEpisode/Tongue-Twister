/** Who may save to the cloud and share (PRD 04 §9, build spec §2). One place, pure, so every screen agrees. */
import type { AgeBand, FeatureFlags } from '../api'

export type SaveAccess =
  /** Flag off: show nothing about the cloud. */
  | 'hidden'
  | 'sign_in'
  /** Signed in, age unknown: the consent dialog asks first. */
  | 'need_age'
  /** Under 13: local only, with a short explanation. */
  | 'blocked_minor'
  | 'ok'

export function saveAccess(input: {
  flags: FeatureFlags
  signedIn: boolean
  ageBand: AgeBand | undefined
}): SaveAccess {
  if (!input.flags.record_cloud) return 'hidden'
  if (!input.signedIn) return 'sign_in'
  if (input.ageBand === 'under13') return 'blocked_minor'
  if (input.ageBand !== '13plus') return 'need_age'
  return 'ok'
}

/** Share links: flag on and a confirmed 13+ owner (the API enforces the same). */
export const canShare = (input: {
  flags: FeatureFlags
  signedIn: boolean
  ageBand: AgeBand | undefined
}): boolean =>
  !!input.flags.share_links && input.signedIn && input.ageBand === '13plus'
