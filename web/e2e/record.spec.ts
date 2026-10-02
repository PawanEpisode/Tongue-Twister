import { expect, test } from '@playwright/test'
import { TWISTER } from './fixtures'
import { liveTrackCount } from './support/media'
import { openApp } from './support/setup'

test('Record with fake devices reaches the review screen with a Download button', async ({
  page,
}) => {
  await openApp(page)
  await page.goto(`/twisters/${TWISTER.slug}?mode=record`)

  // camera_text is the default layout (the layout picker sits behind "Layout & settings"; the summary names
  // the current choice). It needs a camera, so this exercises the fake webcam.
  await expect(page.getByText(/^Camera \+ text card/)).toBeVisible()
  await page.getByRole('button', { name: 'Start camera' }).click()

  await page.getByRole('button', { name: 'Record', exact: true }).click()
  await expect(page.getByText(/^Recording starts in/)).toBeAttached()
  await expect(
    page.getByRole('progressbar', { name: 'Recording time used' }),
  ).toBeVisible({
    timeout: 15_000,
  })
  await page.waitForTimeout(2_000) // a 2 second take

  await page.getByRole('button', { name: 'Stop', exact: true }).click()
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Stop', exact: true })
    .click()

  await expect(
    page
      .getByRole('region', { name: 'Keep this take' })
      .or(page.getByLabel('Keep this take')),
  ).toBeVisible({
    timeout: 30_000,
  })
  await expect(page.getByRole('button', { name: 'Download' })).toBeEnabled()
  // The recorder lets go of the camera once the take exists.
  await expect.poll(() => liveTrackCount(page)).toBe(0)
})
