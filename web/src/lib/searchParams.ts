import { stringifySearchWith } from '@tanstack/react-router'

/**
 * URL search params that read the way people expect: `?difficulty=1`, not `?difficulty=%221%22`.
 *
 * TanStack's default serialiser turns "1" and "true" into a number and a boolean when reading, so to keep
 * the string "1" intact it wraps such strings in quotes when writing. Every route here validates its own
 * params (`validateSearch`) and accepts numeric text, so values stay plain strings both ways instead. Only a string that itself looks like a
 * JSON string (starts and ends with a double quote) is quoted, so it round-trips; this also means old links
 * that carry `%221%22` still open. Objects and arrays are JSON, as before (no route uses them).
 */
const JSON_STRING = /^".*"$/s

function unquote(value: string): unknown {
  if (!JSON_STRING.test(value)) throw new SyntaxError('plain value')
  return JSON.parse(value)
}

/** Every value is the string that was written; a repeated key keeps its last value. */
export function parseSearch(search: string): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of new URLSearchParams(search)) {
    try {
      out[key] = unquote(value)
    } catch {
      out[key] = value
    }
  }
  return out
}

export const stringifySearch = stringifySearchWith(JSON.stringify, unquote)
