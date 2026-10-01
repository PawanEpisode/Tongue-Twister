import { expect, test } from '@playwright/test'
import { GONE_TOKEN, SCORE_CARD_TOKEN } from './fixtures'

// The document itself is what crawlers and uptime monitors see, so these read the raw server response.
const canonicals = (html: string) =>
  html.match(/<link[^>]*rel="canonical"[^>]*>/g) ?? []

test.describe('/s/$token server response', () => {
  test('a live card answers 200 with no canonical', async ({ request }) => {
    const res = await request.get(`/s/${SCORE_CARD_TOKEN}`)
    expect(res.status()).toBe(200)
    const html = await res.text()
    expect(html).toContain('noindex')
    expect(canonicals(html)).toHaveLength(0)
  })

  test('an unknown token answers a real 404 with the friendly page', async ({
    request,
  }) => {
    const res = await request.get('/s/nope')
    expect(res.status()).toBe(404)
    const html = await res.text()
    expect(html).toContain('find this score card')
    expect(html).toContain('noindex')
    expect(canonicals(html)).toHaveLength(0)
  })

  // The router can only answer 200/404/500, so an expired link is a friendly page that is never indexed.
  test('an expired token shows the friendly page and is never indexed', async ({
    request,
  }) => {
    const res = await request.get(`/s/${GONE_TOKEN}`)
    expect(res.status()).toBe(200)
    const html = await res.text()
    expect(html).toContain('expired or was removed')
    expect(html).toContain('noindex')
    expect(canonicals(html)).toHaveLength(0)
  })
})

test('every indexable page has exactly one canonical, its own', async ({
  request,
}) => {
  const home = canonicals(await (await request.get('/')).text())
  expect(home).toHaveLength(1)
  const browse = canonicals(await (await request.get('/twisters')).text())
  expect(browse).toHaveLength(1)
  expect(browse[0]).not.toBe(home[0])
})
