import { describe, expect, it } from 'vitest'
import { newMeta } from './chunkStore'
import { defaultTitle, downloadName, takeFromStored } from './take'

describe('take helpers', () => {
  it('names downloads safely, with the right extension', () => {
    const when = Date.UTC(2026, 8, 29, 12)
    expect(
      downloadName({
        twister: 'fuzzy-wuzzy',
        mime: 'video/webm;codecs=vp9,opus',
        startedAt: when,
      }),
    ).toMatch(/^fuzzy-wuzzy-\d{1,2}-sep\.webm$/)
    expect(
      downloadName({ twister: 'a/b c', mime: 'video/mp4', startedAt: when }),
    ).toMatch(/^a-b-c-.*\.mp4$/)
  })
  it('titles a take from the twister slug', () => {
    expect(defaultTitle('fuzzy-wuzzy', Date.UTC(2026, 8, 29, 12))).toMatch(
      /^Fuzzy Wuzzy — 29 Sep$/,
    )
    expect(defaultTitle('', 0)).toMatch(/^Recording — /)
    expect(defaultTitle('a-'.repeat(30), 0).length).toBeLessThanOrEqual(80)
  })
  it('rebuilds a take from stored chunks and marks it recovered', async () => {
    const meta = {
      ...newMeta({
        id: 't1',
        owner: null,
        twister: 'peter-piper',
        twisterText: 'x',
        layout: 'camera',
        mime: 'video/mp4',
        width: 1280,
        height: 720,
        fps: 30,
        hasCamera: true,
        hasScreen: false,
        hasMic: true,
        hasSystemAudio: false,
        captureSource: 'getUserMedia',
        layoutSettings: {},
      }),
      durationMs: 1000,
    }
    const blob = new Blob([new Uint8Array(20)], { type: 'video/mp4' })
    const take = await takeFromStored(
      meta,
      { blob, durationMs: 47_000, chunks: 47 },
      true,
    )
    expect(take.recovered).toBe(true)
    expect(take.durationMs).toBe(47_000)
    expect(take.sizeBytes).toBe(20)
    expect(take.endedReason).toBe('error') // a crash is "ended early", never silently "user"
  })
})
