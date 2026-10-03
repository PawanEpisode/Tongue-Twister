// The disposable-email list has one source of truth: api/twisters/data/disposable_email_domains.json.
// The web app ships a generated copy (src/lib/disposableDomains.json) for instant sign-up feedback.
//   node scripts/sync-disposable-domains.mjs          write the copy
//   node scripts/sync-disposable-domains.mjs --check  exit 1 if the copy is stale (used by CI / the unit test)
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
export const SOURCE = join(
  root,
  '../api/twisters/data/disposable_email_domains.json',
)
export const COPY = join(root, 'src/lib/disposableDomains.json')

export function render(sourcePath = SOURCE) {
  const { domains } = JSON.parse(readFileSync(sourcePath, 'utf8'))
  const clean = [
    ...new Set(domains.map((d) => String(d).trim().toLowerCase())),
  ].sort()
  return `${JSON.stringify({ generatedFrom: 'api/twisters/data/disposable_email_domains.json', domains: clean }, null, 2)}\n`
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (!existsSync(SOURCE)) {
    console.error('API list not found (web-only checkout?): nothing to sync.')
    process.exit(process.argv.includes('--check') ? 0 : 1)
  }
  const next = render()
  if (process.argv.includes('--check')) {
    const current = existsSync(COPY) ? readFileSync(COPY, 'utf8') : ''
    if (current !== next) {
      console.error(
        'src/lib/disposableDomains.json is stale. Run: npm run sync:disposable',
      )
      process.exit(1)
    }
  } else writeFileSync(COPY, next)
}
