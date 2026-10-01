import { expect, test } from '@playwright/test'
import { DAILY } from './fixtures'
import { openApp } from './support/setup'

test('home renders the hero, today’s twister and the four level cards', async ({
  page,
}) => {
  const api = await openApp(page)
  await page.goto('/')

  await expect(page.getByRole('heading', { level: 1 })).toContainText(
    'Can you say',
  )
  await expect(
    page.getByRole('link', { name: /try today’s twister/i }),
  ).toHaveAttribute('href', `/twisters/${DAILY.twister.slug}`)

  const levels = page
    .getByRole('heading', { name: 'Pick your level' })
    .locator('..')
  for (const name of ['Easy', 'Medium', 'Hard', 'Insane'])
    await expect(
      levels.getByRole('link', { name: new RegExp(name) }),
    ).toBeVisible()
  await expect(levels.getByRole('link', { name: /Hard/ })).toHaveAttribute(
    'href',
    /difficulty=(%22)?3/,
  )

  await expect(
    page.getByRole('heading', { name: 'Sound families' }),
  ).toBeVisible()
  expect(api.unmocked).toEqual([])
})
