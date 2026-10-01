import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { ACHIEVEMENT_ICON_NAMES, achievementIcon } from './achievementIcons'

// The catalogue is the single source of icon names; a badge whose icon is missing here would silently
// render the fallback medal, so the two sides are kept honest with this parity check (as for scoring).
const CATALOGUE = fileURLToPath(
  new URL('../../../../api/twisters/progress/catalogue.py', import.meta.url),
)
const catalogueIcons = [
  ...new Set(
    [...readFileSync(CATALOGUE, 'utf8').matchAll(/icon="([a-z-]+)"/g)].map(
      (m) => m[1],
    ),
  ),
]

describe('achievement icons', () => {
  it('reads a believable number of icons from the catalogue', () => {
    expect(catalogueIcons.length).toBeGreaterThan(10)
  })

  it.each(catalogueIcons)('maps the catalogue icon %s', (name) => {
    expect(ACHIEVEMENT_ICON_NAMES).toContain(name)
  })

  it('maps the masking icon used for secret badges', () => {
    expect(ACHIEVEMENT_ICON_NAMES).toContain('lock')
  })

  it('maps the night owl and early bird icons', () => {
    expect(ACHIEVEMENT_ICON_NAMES).toEqual(
      expect.arrayContaining(['moon', 'sunrise']),
    )
    expect(achievementIcon('moon')).not.toBe(achievementIcon('medal'))
    expect(achievementIcon('sunrise')).not.toBe(achievementIcon('medal'))
  })

  it('falls back to a real icon for an unknown name', () => {
    expect(achievementIcon('definitely-not-an-icon')).toBe(
      achievementIcon('medal'),
    )
  })
})
