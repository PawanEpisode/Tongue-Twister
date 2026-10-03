// @vitest-environment node
import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import list from './disposableDomains.json'

const SOURCE = new URL(
  '../../../api/twisters/data/disposable_email_domains.json',
  import.meta.url,
)

describe('disposable domain list', () => {
  it('is lower-case, sorted and unique', () => {
    expect(list.domains).toEqual([...new Set(list.domains)].sort())
    expect(list.domains.every((d) => d === d.toLowerCase())).toBe(true)
  })
  // Skipped in a web-only checkout; in the monorepo it fails when the API list changed and nobody re-synced.
  it.skipIf(!existsSync(SOURCE))(
    'matches the API list (npm run sync:disposable)',
    () => {
      const api = JSON.parse(readFileSync(SOURCE, 'utf8')) as {
        domains: string[]
      }
      expect(list.domains).toEqual(
        [...new Set(api.domains.map((d) => d.toLowerCase()))].sort(),
      )
    },
  )
})
