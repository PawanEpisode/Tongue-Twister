import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { SCORE_CARD_TOKEN, TWISTER } from './fixtures'
import { blockingViolations } from './support/axe'
import { openApp } from './support/setup'

type Target = {
  name: string
  path: string
  ready: (page: Page) => Promise<void>
  /** Serve the signed-out public site (flag on, locked teaser). */
  publicSite?: boolean
}

const tab = (page: Page, name: string) => page.getByRole('tab', { name })

const PAGES: Target[] = [
  {
    name: 'landing (signed out)',
    path: '/',
    publicSite: true,
    ready: async (p) => {
      await expect(
        p.getByRole('heading', { name: /Questions, answered/ }),
      ).toBeVisible()
      await expect(
        p.getByRole('button', { name: 'Tap and say it' }),
      ).toBeVisible()
    },
  },
  {
    name: 'browse preview (signed out)',
    path: '/twisters',
    publicSite: true,
    ready: async (p) =>
      expect(
        p.getByRole('button', { name: 'Unlock all twisters' }),
      ).toBeVisible(),
  },
  {
    name: 'twister page (signed out)',
    path: `/twisters/${TWISTER.slug}`,
    publicSite: true,
    ready: async (p) =>
      expect(
        p.getByRole('button', { name: 'Practise this twister' }),
      ).toBeVisible(),
  },
  {
    name: 'privacy',
    path: '/privacy',
    publicSite: true,
    ready: async (p) =>
      expect(p.getByRole('heading', { name: 'Privacy policy' })).toBeVisible(),
  },
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
  {
    name: 'shared score card',
    path: `/s/${SCORE_CARD_TOKEN}`,
    ready: async (p) =>
      expect(
        p.getByRole('heading', { name: /Scored 87 on a tongue twister/ }),
      ).toBeVisible(),
  },
]

for (const theme of ['light', 'dark'] as const)
  for (const target of PAGES)
    test(`axe: ${target.name} (${theme})`, async ({ page }) => {
      await openApp(page, { theme, publicSite: target.publicSite })
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
