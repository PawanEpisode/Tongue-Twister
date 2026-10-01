import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { TWISTER } from './fixtures'
import { blockingViolations } from './support/axe'
import { openApp } from './support/setup'

type Target = {
  name: string
  path: string
  ready: (page: Page) => Promise<void>
}

const tab = (page: Page, name: string) => page.getByRole('tab', { name })

const PAGES: Target[] = [
  {
    name: 'home',
    path: '/',
    ready: async (p) => {
      await expect(
        p.getByRole('heading', { name: 'Pick your level' }),
      ).toBeVisible()
      await expect(
        p.getByRole('heading', { name: 'Sound families' }),
      ).toBeVisible()
      await expect(
        p.getByRole('link', { name: /try today’s twister/i }),
      ).toBeVisible()
    },
  },
  {
    name: 'browse',
    path: '/twisters',
    ready: async (p) => {
      await expect(p.getByRole('link', { name: /words/ }).first()).toBeVisible()
      await expect(p.getByRole('button', { name: /Poppers/ })).toBeVisible()
    },
  },
  {
    name: 'twister (read along)',
    path: `/twisters/${TWISTER.slug}?mode=read`,
    ready: async (p) =>
      expect(tab(p, 'Read along')).toHaveAttribute('aria-selected', 'true'),
  },
  {
    name: 'twister (speak)',
    path: `/twisters/${TWISTER.slug}?mode=speak`,
    ready: async (p) => {
      await expect(tab(p, 'Speak & score')).toHaveAttribute(
        'aria-selected',
        'true',
      )
      await expect(
        p.getByRole('button', { name: 'Start speaking' }),
      ).toBeEnabled()
    },
  },
  {
    name: 'twister (record)',
    path: `/twisters/${TWISTER.slug}?mode=record`,
    ready: async (p) =>
      expect(p.getByRole('button', { name: 'Start camera' })).toBeVisible(),
  },
  {
    name: 'stats (guest)',
    path: '/stats',
    ready: async (p) =>
      expect(p.getByRole('heading', { name: 'Your progress' })).toBeVisible(),
  },
  {
    name: 'favorites (guest)',
    path: '/favorites',
    ready: async (p) =>
      expect(p.getByText('Saved on this device.')).toBeVisible(),
  },
  {
    name: 'login',
    path: '/login',
    ready: async (p) =>
      expect(p.getByRole('heading', { name: 'Welcome back' })).toBeVisible(),
  },
]

for (const theme of ['light', 'dark'] as const)
  for (const target of PAGES)
    test(`axe: ${target.name} (${theme})`, async ({ page }) => {
      await openApp(page, { theme })
      await page.goto(target.path)
      await target.ready(page)
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme)

      const found = await blockingViolations(page)
      expect(
        found,
        found
          .map((f) => `${f.rule} [${f.impact}] ${f.selector} — ${f.help}`)
          .join('\n'),
      ).toEqual([])
    })
