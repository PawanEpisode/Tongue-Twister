import type { Page } from '@playwright/test'
import { installProbes } from './media'
import { FLAGS, PUBLIC_FLAGS } from '../fixtures'
import { mockApi } from './mockApi'
import { route as answer } from './router'
import type { MockedApi, Override } from './mockApi'

/** The standard guest test page: API mocked, media/speech probes installed, theme chosen. */
export async function openApp(
  page: Page,
  opts: {
    theme?: 'light' | 'dark'
    speech?: string
    override?: Override
    /** Serve the signed-out public site: flag on and `/twisters/` answers with the locked teaser. */
    publicSite?: boolean
  } = {},
): Promise<MockedApi> {
  const publicSite: Override | undefined = opts.publicSite
    ? (url, method) => {
        const path = url.pathname.replace(/^\/api\/v1/, '')
        if (method === 'GET' && path === '/flags/')
          return { status: 200, body: { flags: PUBLIC_FLAGS } }
        if (method === 'GET' && path === '/twisters/') {
          // The real API gives signed-out callers the curated teaser and says how big the library is.
          const page = answer('GET', path, url.searchParams)
          return {
            status: page.status,
            body: {
              ...(page.body as object),
              locked: true,
              library_total: 205,
            },
          }
        }
        return opts.override?.(url, method)
      }
    : opts.override
  const api = await mockApi(page, publicSite)
  // Seed the flag cache so the first client render already knows which experience this test is about.
  await page.addInitScript(
    (flags: string) => {
      try {
        localStorage.setItem('twister.flags.v1', flags)
      } catch {
        /* storage blocked */
      }
    },
    JSON.stringify(opts.publicSite ? PUBLIC_FLAGS : FLAGS),
  )
  await installProbes(page, { speech: opts.speech })
  const theme = opts.theme ?? 'dark'
  await page.addInitScript((t: string) => {
    try {
      localStorage.setItem('twister-theme', t)
    } catch {
      /* storage blocked */
    }
  }, theme)
  await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' })
  return api
}
