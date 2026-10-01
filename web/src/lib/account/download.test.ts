import { describe, expect, it } from 'vitest'
import { filenameFromContentDisposition as name } from './download'

const FALLBACK = 'twister-export-20261001.json'

describe('filenameFromContentDisposition', () => {
  it('reads a quoted filename', () => {
    expect(
      name('attachment; filename="twister-export-20261003.json"', FALLBACK),
    ).toBe('twister-export-20261003.json')
  })

  it('reads an unquoted filename', () => {
    expect(name('attachment; filename=export.json', FALLBACK)).toBe(
      'export.json',
    )
  })

  it('prefers the RFC 5987 form and decodes it', () => {
    expect(
      name(
        `attachment; filename="fallback.json"; filename*=UTF-8''caf%C3%A9.json`,
        FALLBACK,
      ),
    ).toBe('café.json')
  })

  it('falls back to the plain form when the escape is malformed', () => {
    expect(
      name(
        `attachment; filename="ok.json"; filename*=UTF-8''%E0%A4%A`,
        FALLBACK,
      ),
    ).toBe('ok.json')
  })

  it.each([
    ['a missing header', null],
    ['an empty header', ''],
    ['no filename', 'attachment'],
    ['an empty filename', 'attachment; filename=""'],
  ])('uses the fallback for %s', (_label, header) => {
    expect(name(header, FALLBACK)).toBe(FALLBACK)
  })

  it.each(['../evil.json', 'a/b.json', 'a\\b.json', '..'])(
    'never accepts a path: %s',
    (file) => {
      expect(name(`attachment; filename="${file}"`, FALLBACK)).toBe(FALLBACK)
    },
  )
})
