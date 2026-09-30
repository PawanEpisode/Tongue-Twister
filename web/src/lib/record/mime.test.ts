import { describe, expect, it } from 'vitest'
import { MIME_CHAIN, containerOf, extensionFor, negotiateMime } from './mime'

describe('negotiateMime', () => {
  it('takes the first supported type in the chain (vp9 before vp8 before mp4)', () => {
    expect(negotiateMime(() => true).mime).toBe(MIME_CHAIN[0])
    expect(negotiateMime((t) => t !== MIME_CHAIN[0]).mime).toBe(
      'video/webm;codecs=vp8,opus',
    )
    expect(
      negotiateMime((t) => t.startsWith('video/mp4;codecs=avc1')).mime,
    ).toBe('video/mp4;codecs=avc1.42E01E,mp4a.40.2')
    expect(negotiateMime((t) => t === 'video/mp4')).toEqual({
      mime: 'video/mp4',
      container: 'mp4',
    })
  })
  it('lets the browser choose when nothing matches or the probe is missing or throws', () => {
    expect(negotiateMime(() => false)).toEqual({
      mime: '',
      container: 'unknown',
    })
    expect(negotiateMime(undefined).mime).toBe('')
    expect(
      negotiateMime(() => {
        throw new Error('boom')
      }).mime,
    ).toBe('')
  })
  it('maps mime to container and file extension', () => {
    expect(containerOf('video/webm;codecs=vp9,opus')).toBe('webm')
    expect(containerOf('VIDEO/MP4')).toBe('mp4')
    expect(containerOf('')).toBe('unknown')
    expect(extensionFor('video/mp4;codecs=avc1')).toBe('mp4')
    expect(extensionFor('')).toBe('webm')
  })
})
