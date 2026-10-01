import { describe, expect, it } from 'vitest'
import { timezoneOptions } from './timezones'

describe('timezoneOptions', () => {
  it('lists the supported zones, sorted, with UTC always present', () => {
    expect(
      timezoneOptions('UTC', undefined, ['Europe/Paris', 'Asia/Tokyo']),
    ).toEqual(['Asia/Tokyo', 'Europe/Paris', 'UTC'])
  })

  it('keeps the saved zone and the browser zone even if the list lacks them', () => {
    const out = timezoneOptions('Asia/Kolkata', 'Pacific/Apia', [
      'Europe/Paris',
    ])
    expect(out).toContain('Asia/Kolkata')
    expect(out).toContain('Pacific/Apia')
  })

  it('does not repeat a zone', () => {
    const out = timezoneOptions('Europe/Paris', 'Europe/Paris', [
      'Europe/Paris',
    ])
    expect(out.filter((z) => z === 'Europe/Paris')).toHaveLength(1)
  })

  it('works with no zone list at all', () => {
    expect(timezoneOptions(undefined, undefined, [])).toEqual(['UTC'])
  })

  it('reads the real list from the runtime by default', () => {
    expect(timezoneOptions('UTC', undefined).length).toBeGreaterThan(1)
  })
})
