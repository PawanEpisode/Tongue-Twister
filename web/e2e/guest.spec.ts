import { expect, test } from '@playwright/test'
import { openApp } from './support/setup'

test('/stats asks guests to sign in', async ({ page }) => {
  await openApp(page)
  await page.goto('/stats')
  await expect(
    page.getByRole('heading', { name: 'Your progress' }),
  ).toBeVisible()
  await expect(
    page.getByText('Sign in to keep your scores, streaks and achievements.'),
  ).toBeVisible()
  await expect(
    page.getByRole('link', { name: 'Sign in' }).last(),
  ).toHaveAttribute('href', /\/login\?redirect=%2Fstats/)
})

test('/favorites tells guests their stars live on this device', async ({
  page,
}) => {
  await openApp(page)
  await page.goto('/favorites')
  await expect(page.getByRole('heading', { name: 'Favourites' })).toBeVisible()
  await expect(page.getByText('Saved on this device.')).toBeVisible()
  await expect(
    page.getByRole('link', { name: 'Sign in to keep them' }),
  ).toHaveAttribute('href', /\/login\?redirect=%2Ffavorites/)
})
