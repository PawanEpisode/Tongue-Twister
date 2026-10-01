import { expect, test } from '@playwright/test'
import { TWISTER } from './fixtures'
import { openApp } from './support/setup'

const GUEST_QUEUE = 'twister.guest.v1'

test('a take made offline is scored locally and queued on the device', async ({
  page,
  context,
}) => {
  await openApp(page, { speech: TWISTER.text })
  await page.goto(`/twisters/${TWISTER.slug}?mode=speak`)
  await expect(
    page.getByRole('button', { name: 'Start speaking' }),
  ).toBeEnabled()

  await context.setOffline(true)
  await page.getByRole('button', { name: 'Start speaking' }).click()

  // The fake recogniser "hears" the whole sentence; the take auto-stops and a local score appears.
  await expect(page.getByText('6 of 6 words correct')).toBeVisible({
    timeout: 20_000,
  })
  await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible()

  const queued = await page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key) ?? 'null'),
    GUEST_QUEUE,
  )
  expect(queued.attempts).toHaveLength(1)
  expect(queued.attempts[0]).toMatchObject({
    twister: TWISTER.slug,
    transcript: TWISTER.text,
  })
  expect(typeof queued.batchId).toBe('string')
})
