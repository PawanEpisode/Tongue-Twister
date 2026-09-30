/** The opt-in name shown on shared recordings. Mirrors the API's `validate_public_name` (≤ 40, blank = anonymous). */
export const PUBLIC_NAME_MAX = 40

export type PublicNameCheck =
  { ok: true; value: string } | { ok: false; reason: string }

// eslint-disable-next-line no-control-regex -- rejecting control characters is the point
const CONTROL = /[\u0000-\u001f\u007f]/

/** Trims and collapses whitespace; length is counted in characters (code points), like the server. */
export function validatePublicName(raw: string): PublicNameCheck {
  if (CONTROL.test(raw.replace(/\s/g, ' ')))
    return { ok: false, reason: 'Use letters, numbers and normal punctuation.' }
  const value = raw.trim().replace(/\s+/g, ' ')
  if ([...value].length > PUBLIC_NAME_MAX)
    return {
      ok: false,
      reason: `Keep it to ${PUBLIC_NAME_MAX} characters or fewer.`,
    }
  return { ok: true, value }
}
