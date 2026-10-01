import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { TWISTER } from './fixtures'
import { liveTrackCount, streamCount } from './support/media'
import { openApp } from './support/setup'

const URL = `/twisters/${TWISTER.slug}`
const tab = (page: Page, name: string) => page.getByRole('tab', { name })

async function selectMode(page: Page, name: string) {
  await tab(page, name).click()
  await expect(tab(page, name)).toHaveAttribute('aria-selected', 'true')
}

test('switching Read along → Speak → Record leaves no live media tracks behind', async ({
  page,
}) => {
  await openApp(page, { speech: TWISTER.text })
  await page.goto(`${URL}?mode=read`)
  await expect(tab(page, 'Read along')).toHaveAttribute('aria-selected', 'true')
  expect(await liveTrackCount(page)).toBe(0)

  // Speak: opening the mic takes a live audio track…
  await selectMode(page, 'Speak & score')
  await page.getByRole('button', { name: 'Start speaking' }).click()
  await expect.poll(() => liveTrackCount(page)).toBeGreaterThan(0)

  // …and leaving the mode must release it, mid-take.
  await selectMode(page, 'Record')
  await expect.poll(() => liveTrackCount(page)).toBe(0)

  // Record: Start camera opens camera + microphone for the preview.
  await page.getByRole('button', { name: 'Start camera' }).click()
  await expect(
    page.getByRole('button', { name: 'Record', exact: true }),
  ).toBeVisible()
  await expect.poll(() => liveTrackCount(page)).toBeGreaterThan(0)

  await selectMode(page, 'Read along')
  await expect.poll(() => liveTrackCount(page)).toBe(0)

  expect(await streamCount(page)).toBeGreaterThanOrEqual(2)
})
