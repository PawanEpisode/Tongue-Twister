/// <reference types="node" />
import {
  CATEGORIES,
  DAILY,
  FACETS,
  FLAGS,
  GONE_TOKEN,
  PREFERENCES,
  SCORE_CARD,
  SCORE_CARD_TOKEN,
  TWISTER,
  TWISTERS,
} from '../fixtures'

export type ApiReply = { status: number; body: unknown }

const json = (body: unknown, status = 200): ApiReply => ({ status, body })
const notFound = (): ApiReply =>
  json({ error: { code: 'not_found', request_id: 'e2e' } }, 404)

/** Filters the way the real list endpoint does, closely enough for the UI to be exercised. */
function listTwisters(params: URLSearchParams): ApiReply {
  const difficulty = params.get('difficulty')
  const category = params.get('category')
  const origin = params.get('origin')
  const search = params.get('search')?.toLowerCase()
  const results = TWISTERS.filter(
    (t) =>
      (!difficulty || String(t.difficulty) === difficulty) &&
      (!category || t.category === category) &&
      (!origin || t.origin === origin) &&
      (!search || t.text.toLowerCase().includes(search)),
  )
  return json({ count: results.length, results })
}

/**
 * One router for the whole mocked API. Playwright's `page.route` uses it for browser calls and the
 * globalSetup HTTP server uses it for server-side rendering (route loaders run in Node, where
 * `page.route` cannot see them). `path` is the part after `/api/v1`.
 */
export function route(
  method: string,
  path: string,
  search: URLSearchParams,
): ApiReply {
  if (method !== 'GET') return json({ error: { code: 'unmocked' } }, 405)
  if (path === '/categories/') return json(CATEGORIES)
  if (path === '/twisters/') return listTwisters(search)
  if (path === '/twisters/facets/') return json(FACETS)
  if (path === '/twisters/random/') return json(TWISTER)
  if (path === '/daily/') return json(DAILY)
  if (path === '/flags/') return json({ flags: FLAGS })
  if (path === '/me/preferences/') return json(PREFERENCES)
  const card = /^\/public\/s\/([^/]+)\/$/.exec(path)
  if (card) {
    if (card[1] === SCORE_CARD_TOKEN) return json(SCORE_CARD)
    if (card[1] === GONE_TOKEN)
      return json({ error: { code: 'gone', request_id: 'e2e' } }, 410)
    return notFound()
  }
  const one = /^\/twisters\/([^/]+)\/$/.exec(path)
  if (one) {
    const t = TWISTERS.find((x) => x.slug === one[1])
    return t ? json(t) : notFound()
  }
  return json({ error: { code: 'unmocked', request_id: path } }, 404)
}

/** Paths under `/api/v1` this router answers, for tests that want to assert nothing else was called. */
export const MOCKED_PREFIXES = [
  '/categories/',
  '/twisters/',
  '/daily/',
  '/flags/',
  '/me/preferences/',
  '/public/s/',
]
