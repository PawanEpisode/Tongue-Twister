import { ApiError, api } from '#/lib/api'
import type { ScoreCardPublic } from '#/lib/api'
import { SITE_NAME, seo } from '#/lib/seo'

/** How long the server waits for the API before the page shows its retry state instead of hanging. */
export const SCORE_CARD_TIMEOUT_MS = 5000

/** What the public score-card page can be in. Plain data, so the router can serialise it from the server. */
export type ScoreCardState =
  | { kind: 'ok'; card: ScoreCardPublic }
  | { kind: 'missing' } // 404: mistyped or never existed
  | { kind: 'gone' } // 410: expired, revoked, or the attempt/account was deleted
  | { kind: 'unavailable' } // 403: the score-card kill switch is off
  | { kind: 'error' } // anything else; worth a retry

export function classifyScoreCardError(err: unknown): ScoreCardState {
  if (err instanceof ApiError) {
    if (err.status === 404) return { kind: 'missing' }
    if (err.status === 410) return { kind: 'gone' }
    if (err.status === 403) return { kind: 'unavailable' }
  }
  return { kind: 'error' }
}

/**
 * Never throws: the page always has something to render, and the head always has something to read.
 * The call is abandoned after `timeoutMs`; that becomes the retryable `error` state.
 */
export async function loadScoreCard(
  token: string,
  fetchCard: (
    token: string,
    signal?: AbortSignal,
  ) => Promise<ScoreCardPublic> = api.publicScoreCard,
  timeoutMs = SCORE_CARD_TIMEOUT_MS,
): Promise<ScoreCardState> {
  try {
    return {
      kind: 'ok',
      card: await fetchCard(token, AbortSignal.timeout(timeoutMs)),
    }
  } catch (err) {
    return classifyScoreCardError(err)
  }
}

const EXCERPT_MAX = 110

/** The twister cut at a word boundary, for descriptions and link previews. */
export function excerpt(text: string, max = EXCERPT_MAX): string {
  const clean = text.replace(/\s+/g, ' ').trim()
  if ([...clean].length <= max) return clean
  const cut = [...clean].slice(0, max).join('')
  const lastSpace = cut.lastIndexOf(' ')
  // Prefer a word boundary, unless that would throw away most of the allowance.
  return `${lastSpace > max / 2 ? cut.slice(0, lastSpace) : cut}…`
}

const ownerName = (card: ScoreCardPublic): string | null =>
  card.owner?.display_name?.trim() || null

export function scoreCardTitle(card: ScoreCardPublic): string {
  const score = Math.round(card.score)
  const who = ownerName(card)
  return who
    ? `${who} scored ${score} on a tongue twister`
    : `Scored ${score} on a tongue twister`
}

export function scoreCardDescription(card: ScoreCardPublic): string {
  const accuracy = Math.round(card.accuracy * 100)
  return `“${excerpt(card.twister.text)}” — ${accuracy}% accuracy at ${Math.round(card.wpm)} wpm. Can you beat it?`
}

const GENERIC_TITLE = 'A Twister score card'
const GENERIC_DESCRIPTION = 'Someone shared a tongue twister score with you.'

/**
 * Title and link-preview tags. Crawlers read these from the server-rendered HTML, so they come from
 * the loader's data. The page is never indexed, and it has no canonical URL (every link is unique, and the root route adds none).
 * Like `/r/$token` it asks browsers not to leak the link in the Referer header.
 */
export function scoreCardHead(
  state: ScoreCardState | undefined,
  token: string,
) {
  const card = state?.kind === 'ok' ? state.card : null
  const ogImage = card?.images?.og
  const base = seo({
    title: card ? `${scoreCardTitle(card)} | ${SITE_NAME}` : GENERIC_TITLE,
    description: card ? scoreCardDescription(card) : GENERIC_DESCRIPTION,
    path: `/s/${encodeURIComponent(token)}`,
    noindex: true,
    ...(ogImage && { image: ogImage }),
  })
  const meta = base.meta.map((m) => {
    // The default image is a JPEG; the rendered card is a PNG.
    if ('property' in m && m.property === 'og:image:type' && ogImage)
      return { ...m, content: 'image/png' }
    if ('property' in m && m.property === 'og:image:alt' && card)
      return {
        ...m,
        content: `Score card: ${Math.round(card.score)} out of 100`,
      }
    return m
  })
  return {
    meta: [...meta, { name: 'referrer', content: 'no-referrer' }],
  }
}
