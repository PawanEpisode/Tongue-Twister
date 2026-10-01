import type { Page, Route } from '@playwright/test'
import { API_ORIGIN } from './apiServer'
import { MOCKED_PREFIXES, route as answer } from './router'
import type { ApiReply } from './router'

export type Override = (url: URL, method: string) => ApiReply | undefined

export type MockedApi = {
  /** Every API call the page made, in order (`GET /twisters/?difficulty=2`). */
  calls: string[]
  /** Calls the mock router had no answer for; specs that care assert this stays empty. */
  unmocked: string[]
  /** Calls whose path starts with `prefix`, as URLs. */
  to: (prefix: string) => URL[]
}

/**
 * Answers every `/api/v1/**` request from the fixtures, so no test needs a backend. `override` may replace
 * a reply for one test (return undefined to fall through). Guests only: nothing here issues tokens.
 */
export async function mockApi(
  page: Page,
  override?: Override,
): Promise<MockedApi> {
  const api: MockedApi = {
    calls: [],
    unmocked: [],
    to: (prefix) =>
      api.calls
        .map((c) => new URL(c.replace(/^\S+ /, ''), API_ORIGIN))
        .filter((u) => u.pathname.replace(/^\/api\/v1/, '').startsWith(prefix)),
  }
  // Keep the suite hermetic: web fonts are the only third-party requests the app makes.
  await page.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//, (route) =>
    route.fulfill({ status: 200, contentType: 'text/css', body: '' }),
  )
  await page.route(`${API_ORIGIN}/api/v1/**`, async (route: Route) => {
    const req = route.request()
    const cors = {
      'Access-Control-Allow-Origin': req.headers().origin ?? '*',
      'Access-Control-Allow-Headers': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    }
    if (req.method() === 'OPTIONS')
      return route.fulfill({ status: 204, headers: cors })
    const url = new URL(req.url())
    const path = url.pathname.replace(/^\/api\/v1/, '')
    api.calls.push(`${req.method()} ${path}${url.search}`)
    const reply =
      override?.(url, req.method()) ??
      answer(req.method(), path, url.searchParams)
    if (
      !MOCKED_PREFIXES.some((p) => path.startsWith(p)) &&
      reply.status === 404
    )
      api.unmocked.push(`${req.method()} ${path}`)
    await route.fulfill({
      status: reply.status,
      headers: cors,
      contentType: 'application/json',
      body: JSON.stringify(reply.body),
    })
  })
  return api
}
