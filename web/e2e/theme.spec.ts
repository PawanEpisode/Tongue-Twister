import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { openApp } from './support/setup'

// The dropdown library loads on first use, so this proves the lazy hand-over still gives a working menu.

/** The header's theme button (the public footer carries a second one). */
const themeButton = (page: Page) =>
  page.getByRole('banner').getByRole('button', { name: /^Theme:/ })

test('theme menu opens on first press, switches theme, and closes with Escape', async ({
  page,
}) => {
  await openApp(page)
  await page.goto('/')
  const trigger = themeButton(page)
  await expect(trigger).toHaveAttribute('aria-haspopup', 'menu')

  await trigger.click()
  await expect(
    page.getByRole('menuitemradio', { name: 'Light', exact: true }),
  ).toBeVisible()
  await page.getByRole('menuitemradio', { name: 'Light', exact: true }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')

  await themeButton(page).click()
  await expect(page.getByRole('menu')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('menu')).toBeHidden()
  await expect(themeButton(page)).toBeFocused()
})

test('theme menu opens from the keyboard', async ({ page }) => {
  await openApp(page)
  await page.goto('/')
  await themeButton(page).focus()
  await page.keyboard.press('ArrowDown')
  await expect(page.getByRole('menu')).toBeVisible()
})
