import { expect, test } from '@playwright/test'
import { TWISTERS } from './fixtures'
import { openApp } from './support/setup'

test('a filter chip changes the request parameters and the list', async ({
  page,
}) => {
  const api = await openApp(page)
  await page.goto('/twisters')

  const cards = page.getByRole('link', { name: /words/ })
  await expect(cards).toHaveCount(TWISTERS.length)

  await page.getByRole('button', { name: /^Easy/ }).click()

  // TanStack Router quotes numeric-looking search strings (difficulty=%221%22); accept both spellings.
  await expect(page).toHaveURL(/difficulty=(%22)?1/)
  await expect(page.getByRole('button', { name: /^Easy/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await expect(cards).toHaveCount(1)
  await expect(
    page.getByText('Six slippery snails slid slowly seaward.'),
  ).toBeVisible()

  const lastList = api
    .to('/twisters/')
    .filter((u) => u.search.includes('difficulty'))
    .at(-1)
  expect(lastList?.searchParams.get('difficulty')).toBe('1')
  expect(api.unmocked).toEqual([])

  // Clearing the filter restores the full list.
  await page.getByRole('button', { name: 'All levels' }).click()
  await expect(cards).toHaveCount(TWISTERS.length)
})

test('a sound-family chip filters by category', async ({ page }) => {
  const api = await openApp(page)
  await page.goto('/twisters')
  await expect(page.getByRole('link', { name: /words/ })).toHaveCount(
    TWISTERS.length,
  )

  await page.getByRole('button', { name: /Poppers/ }).click()

  await expect(page).toHaveURL(/category=poppers/)
  await expect(page.getByRole('link', { name: /words/ })).toHaveCount(2)
  expect(
    api
      .to('/twisters/')
      .some((u) => u.searchParams.get('category') === 'poppers'),
  ).toBe(true)
})
