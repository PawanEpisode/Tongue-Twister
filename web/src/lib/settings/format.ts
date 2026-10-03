import type { RangeField } from './schema'

/** The value as shown beside its slider ("1.2×", "3s", "Off"). */
export function formatRangeValue(
  field: Pick<RangeField, 'unit' | 'zeroLabel'>,
  value: number,
): string {
  if (value === 0 && field.zeroLabel) return field.zeroLabel
  const rounded = Number.isInteger(value)
    ? String(value)
    : String(+value.toFixed(2))
  if (field.unit === 'attempts')
    return `${rounded} ${value === 1 ? 'attempt' : 'attempts'}`
  if (!field.unit) return `${Math.round(value * 100)}%`
  return field.unit === '×' || field.unit === '%'
    ? `${rounded}${field.unit}`
    : field.unit === 's'
      ? `${rounded}s`
      : `${rounded} ${field.unit}`
}
