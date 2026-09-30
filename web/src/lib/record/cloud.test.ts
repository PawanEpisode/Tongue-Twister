import { describe, expect, it } from 'vitest'
import { THUMBNAIL_MAX_BYTES, base64Bytes, buildCreateBody } from './cloud'
import type { Take } from './take'

const take: Take = {
  id: 'take-1',
  blob: new Blob([new Uint8Array(1234)], {
    type: 'video/webm;codecs=vp9,opus',
  }),
  durationMs: 41_234.6,
  mime: 'video/webm;codecs=vp9,opus',
  sizeBytes: 1234,
  width: 1280,
  height: 720,
  fps: 30,
  layout: 'camera_text',
  twister: 'fuzzy-wuzzy',
  twisterText: 'Fuzzy Wuzzy was a bear',
  hasCamera: true,
  hasScreen: false,
  hasMic: true,
  hasSystemAudio: false,
  captureSource: 'getUserMedia',
  endedReason: 'user',
  recovered: false,
  startedAt: 0,
  attemptId: null,
  analysis: null,
  layoutSettings: { split_ratio: 0.5 },
}

describe('buildCreateBody', () => {
  it('maps a take onto the POST /recordings/ contract', () => {
    expect(
      buildCreateBody(take, {
        title: '  Fuzzy Wuzzy — 29 Sep ',
        attemptId: 42,
      }),
    ).toEqual({
      client_recording_id: 'take-1',
      twister: 'fuzzy-wuzzy',
      attempt: 42,
      layout: 'camera_text',
      layout_settings: { split_ratio: 0.5 },
      has_camera: true,
      has_screen: false,
      has_mic: true,
      has_system_audio: false,
      capture_source: 'getUserMedia',
      duration_ms: 41235,
      width: 1280,
      height: 720,
      fps: 30,
      mime_type: 'video/webm;codecs=vp9,opus',
      size_bytes: 1234,
      title: 'Fuzzy Wuzzy — 29 Sep',
      recovered: false,
      ended_reason: 'user',
      consent: { recording_upload: 'v1' },
    })
  })
  it('leaves out an attempt that does not exist and caps the title', () => {
    const b = buildCreateBody(take, { title: 'x'.repeat(200), attemptId: null })
    expect('attempt' in b).toBe(false)
    expect(b.title).toHaveLength(80)
    expect(buildCreateBody(take, { title: '   ', attemptId: null }).title).toBe(
      'Recording',
    )
  })
  it('the declared size is the real blob size', () => {
    expect(
      buildCreateBody(
        { ...take, sizeBytes: 1 },
        { title: 't', attemptId: null },
      ).size_bytes,
    ).toBe(1234)
  })
})

describe('base64Bytes', () => {
  it('measures decoded size for the 200 KB thumbnail limit', () => {
    expect(base64Bytes('data:image/jpeg;base64,QUJD')).toBe(3)
    expect(base64Bytes('data:image/jpeg;base64,QUI=')).toBe(2)
    expect(base64Bytes('data:image/jpeg;base64,QQ==')).toBe(1)
    expect(THUMBNAIL_MAX_BYTES).toBe(204800)
  })
})
