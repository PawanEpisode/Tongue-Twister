import { describe, expect, it, vi } from 'vitest'
import { ApiError } from '#/lib/api'
import type { ScoreCardPublic } from '#/lib/api'
import {
  classifyScoreCardError,
  excerpt,
  loadScoreCard,
  scoreCardDescription,
  scoreCardHead,
  scoreCardTitle,
} from './scoreCard'

const card = (over: Partial<ScoreCardPublic> = {}): ScoreCardPublic => ({
  score: 86.6,
  accuracy: 0.92,
  wpm: 118.4,
  kind: 'test',
  twister: { slug: 'red-lorry', text: 'Red lorry, yellow lorry' },
  words: [{ target: 'red', status: 'correct' }],
  created_at: '2026-10-01T10:00:00Z',
  ...over,
})
const meta = (state: Parameters<typeof scoreCardHead>[0]) =>
  scoreCardHead(state, 'tok').meta
const prop = (m: ReturnType<typeof meta>, key: string) =>
  m.find(
    (x) =>
      ('property' in x && x.property === key) ||
      ('name' in x && x.name === key),
  )

describe('classifyScoreCardError', () => {
  it.each([
    [404, 'missing'],
    [410, 'gone'],
    [403, 'unavailable'],
    [500, 'error'],
    [429, 'error'],
  ])('maps API %i to %s', (status, kind) => {
    expect(classifyScoreCardError(new ApiError(status, 'x'))).toEqual({ kind })
  })

  it('treats a network failure as a retryable error', () => {
    expect(classifyScoreCardError(new TypeError('Failed to fetch'))).toEqual({
      kind: 'error',
    })
  })
})

describe('loadScoreCard', () => {
  it('returns the card', async () => {
    const fetchCard = vi.fn().mockResolvedValue(card())
    await expect(loadScoreCard('t', fetchCard)).resolves.toEqual({
      kind: 'ok',
      card: card(),
    })
    expect(fetchCard).toHaveBeenCalledWith('t', expect.any(AbortSignal))
  })

  it('never throws', async () => {
    const fetchCard = vi.fn().mockRejectedValue(new ApiError(410, 'gone'))
    await expect(loadScoreCard('t', fetchCard)).resolves.toEqual({
      kind: 'gone',
    })
  })

  it('gives up on a hung API and shows the retry state', async () => {
    const hung = (_token: string, signal?: AbortSignal) =>
      new Promise<ScoreCardPublic>((_, reject) =>
        signal?.addEventListener('abort', () => reject(signal.reason)),
      )
    await expect(loadScoreCard('t', hung, 20)).resolves.toEqual({
      kind: 'error',
    })
  })
})

describe('excerpt', () => {
  it('keeps short text as it is and tidies whitespace', () => {
    expect(excerpt('  Red   lorry\n yellow ')).toBe('Red lorry yellow')
  })

  it('cuts long text at a word and adds an ellipsis', () => {
    const out = excerpt('one two three four five six seven', 15)
    expect(out).toBe('one two three…')
  })

  it('cuts a single huge word by characters', () => {
    expect(excerpt('x'.repeat(50), 10)).toBe(`${'x'.repeat(10)}…`)
  })

  it('counts characters, not UTF-16 units', () => {
    expect(excerpt('😀'.repeat(5), 5)).toBe('😀'.repeat(5))
  })
})

describe('score card copy', () => {
  it('titles with the rounded score, and the owner only when there is one', () => {
    expect(scoreCardTitle(card())).toBe('Scored 87 on a tongue twister')
    expect(scoreCardTitle(card({ owner: { display_name: 'Ana' } }))).toBe(
      'Ana scored 87 on a tongue twister',
    )
    expect(scoreCardTitle(card({ owner: { display_name: '  ' } }))).toBe(
      'Scored 87 on a tongue twister',
    )
  })

  it('describes accuracy and speed', () => {
    expect(scoreCardDescription(card())).toContain('92% accuracy at 118 wpm')
  })
})

describe('scoreCardHead', () => {
  const images = {
    og: 'https://api.example/s/tok/image.png?size=og',
    square: 'x',
  }

  it('uses the rendered card as the preview image', () => {
    const m = meta({ kind: 'ok', card: card({ images }) })
    expect(prop(m, 'og:image')).toMatchObject({ content: images.og })
    expect(prop(m, 'twitter:image')).toMatchObject({ content: images.og })
    expect(prop(m, 'og:image:type')).toMatchObject({ content: 'image/png' })
    expect(prop(m, 'twitter:card')).toMatchObject({
      content: 'summary_large_image',
    })
    expect(prop(m, 'og:title')).toMatchObject({
      content: expect.stringContaining('87'),
    })
  })

  it('falls back to the site image when the API sent none', () => {
    const m = meta({ kind: 'ok', card: card() })
    expect(prop(m, 'og:image')).toMatchObject({
      content: expect.stringMatching(/og-image\.jpg$/),
    })
    expect(prop(m, 'og:image:type')).toMatchObject({ content: 'image/jpeg' })
  })

  it.each(['missing', 'gone', 'error', 'unavailable'] as const)(
    'is generic and unrevealing for %s',
    (kind) => {
      const m = meta({ kind })
      expect(prop(m, 'og:title')).toMatchObject({
        content: 'A Twister score card',
      })
    },
  )

  it('is generic before the loader has data', () => {
    expect(prop(meta(undefined), 'og:title')).toMatchObject({
      content: 'A Twister score card',
    })
  })

  it('is never indexed, never leaks the link, and has no canonical', () => {
    const head = scoreCardHead({ kind: 'ok', card: card() }, 'tok')
    expect(prop(head.meta, 'robots')).toMatchObject({
      content: 'noindex, nofollow',
    })
    expect(prop(head.meta, 'referrer')).toMatchObject({
      content: 'no-referrer',
    })
    expect(head).not.toHaveProperty('links')
  })

  it('points og:url at the share link itself', () => {
    expect(prop(meta({ kind: 'ok', card: card() }), 'og:url')).toMatchObject({
      content: expect.stringMatching(/\/s\/tok$/),
    })
  })
})
