import { PUBLIC_NAME_MAX } from '#/lib/publicName'

/** Mirrors api/twisters/names.py::validate_display_name — the API is the authority. */
export const DISPLAY_NAME_MIN = 2
export const DISPLAY_NAME_MAX = PUBLIC_NAME_MAX

export type DisplayNameCheck =
  { ok: true; value: string } | { ok: false; reason: string }

// eslint-disable-next-line no-control-regex -- rejecting control characters is the point
const CONTROL = /[\u0000-\u001f\u007f]/
/** Links and markup have no place in a name other people may see. */
const UNSAFE = /[<>@]|:\/\/|www\./i

/** Trims and collapses whitespace; lengths are in characters (code points), like the server. */
export function validateDisplayName(raw: string): DisplayNameCheck {
  if (CONTROL.test(raw.replace(/\s/g, ' ')))
    return { ok: false, reason: 'Use letters, numbers and normal punctuation.' }
  const value = raw.trim().replace(/\s+/g, ' ')
  const length = [...value].length
  if (length < DISPLAY_NAME_MIN)
    return {
      ok: false,
      reason: `Use at least ${DISPLAY_NAME_MIN} characters.`,
    }
  if (length > DISPLAY_NAME_MAX)
    return {
      ok: false,
      reason: `Keep it to ${DISPLAY_NAME_MAX} characters or fewer.`,
    }
  if (UNSAFE.test(value))
    return {
      ok: false,
      reason: 'Leave out links, e-mail addresses and symbols like @ < >.',
    }
  return { ok: true, value }
}
