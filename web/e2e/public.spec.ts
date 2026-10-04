import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { TWISTER } from './fixtures'
import { openApp } from './support/setup'

const gate = (page: Page) => page.getByRole('dialog')

test.describe('the signed-out public site', () => {
  test('home sells the product instead of showing the app', async ({
    page,
  }) => {
    const api = await openApp(page, { publicSite: true })
    await page.goto('/')
    await expect(page.getByRole('heading', { level: 1 })).toContainText(
      'Tongue-tied to tongue-twisting.',
    )
    // None of the member-app furniture is on the signed-out home page.
    await expect(
      page.getByRole('heading', { name: 'Pick your level' }),
    ).toHaveCount(0)
    for (const h of [
      /Three steps from/,
      /Three ways to/,
      /Questions, answered/,
    ])
      await expect(page.getByRole('heading', { name: h })).toBeVisible()
    expect(api.unmocked).toEqual([])
  })

  test('Start free opens the sign-in sheet, and Escape closes it', async ({
    page,
  }) => {
    await openApp(page, { publicSite: true })
    await page.goto('/')
    await page.getByRole('button', { name: 'Start free' }).first().click()
    await expect(gate(page)).toBeVisible()
    await expect(
      gate(page).getByRole('heading', { name: 'Create your free account' }),
    ).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(gate(page)).toHaveCount(0)
  })

  test('the demo shows a scored example and then asks to save it', async ({
    page,
  }) => {
    await openApp(page, { publicSite: true })
    await page.goto('/')
    await page.getByRole('button', { name: 'Watch an example' }).click()
    await expect(
      page.getByRole('status').filter({ hasText: 'An example run' }),
    ).toBeVisible()
    await page.getByRole('button', { name: 'Now you try' }).waitFor()
    // A real take (not the example) is what offers "Save this score"; the example offers "Now you try".
    await expect(
      page.getByRole('button', { name: 'Save this score' }),
    ).toHaveCount(0)
  })

  test('the footer has the maker credit and LinkedIn, and no legal links', async ({
    page,
  }) => {
    await openApp(page, { publicSite: true })
    await page.goto('/')
    const footer = page.getByRole('contentinfo')
    await expect(footer.getByText('Made with')).toBeVisible()
    await expect(footer.getByRole('link', { name: 'Pawan' })).toHaveAttribute(
      'href',
      'https://www.linkedin.com/in/pawankumar1201',
    )
    await expect(
      footer.getByRole('link', { name: /LinkedIn/ }),
    ).toHaveAttribute('target', '_blank')
    await expect(
      footer.getByRole('link', { name: /privacy|terms|contact/i }),
    ).toHaveCount(0)
  })

  test('browse shows the preview and a way to unlock the rest', async ({
    page,
  }) => {
    await openApp(page, { publicSite: true })
    await page.goto('/twisters')
    await expect(page.getByText(/\+\d+ more twisters inside/)).toBeVisible()
    await page.getByRole('button', { name: 'Unlock all twisters' }).click()
    await expect(
      gate(page).getByRole('heading', { name: 'Unlock the full library' }),
    ).toBeVisible()
  })

  test('starring a twister asks for an account', async ({ page }) => {
    await openApp(page, { publicSite: true })
    await page.goto('/twisters')
    await page
      .getByRole('button', { name: /Add to favourites/ })
      .first()
      .click()
    await expect(
      gate(page).getByRole('heading', { name: 'Keep your favourites' }),
    ).toBeVisible()
  })

  test('a twister page lets you read it and gates the practice', async ({
    page,
  }) => {
    await openApp(page, { publicSite: true })
    await page.goto(`/twisters/${TWISTER.slug}`)
    await expect(page.getByRole('heading', { level: 1 })).toContainText(
      'She sells seashells',
    )
    // No microphone controls for a signed-out visitor.
    await expect(
      page.getByRole('button', { name: 'Start speaking' }),
    ).toHaveCount(0)
    await page.getByRole('button', { name: 'Practise this twister' }).click()
    await expect(
      gate(page).getByRole('heading', { name: 'Sign in to start practising' }),
    ).toBeVisible()
  })

  test('privacy, terms and about are public pages', async ({ page }) => {
    await openApp(page, { publicSite: true })
    for (const [path, name] of [
      ['/privacy', 'Privacy policy'],
      ['/terms', 'Terms of use'],
      ['/about', 'About Twister'],
    ] as const) {
      await page.goto(path)
      await expect(page.getByRole('heading', { level: 1, name })).toBeVisible()
    }
  })

  test('with the kill switch off, signed-out visitors get the old home page', async ({
    page,
  }) => {
    await openApp(page)
    await page.goto('/')
    await expect(page.getByRole('heading', { level: 1 })).toContainText(
      'Can you say',
    )
  })
})
