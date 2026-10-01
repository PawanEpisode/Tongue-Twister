import type { Page } from '@playwright/test'
import { installProbes } from './media'
import { mockApi } from './mockApi'
import type { MockedApi, Override } from './mockApi'

/** The standard guest test page: API mocked, media/speech probes installed, theme chosen. */
export async function openApp(
  page: Page,
  opts: { theme?: 'light' | 'dark'; speech?: string; override?: Override } = {},
): Promise<MockedApi> {
  const api = await mockApi(page, opts.override)
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
