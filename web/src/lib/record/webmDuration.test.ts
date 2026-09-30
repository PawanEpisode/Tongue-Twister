import { describe, expect, it } from 'vitest'
import {
  encodeSize,
  fixWebmDuration,
  patchWebmHead,
  readWebmDurationMs,
} from './webmDuration'

const bytes = (...n: number[]) => Uint8Array.from(n)
const cat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((a, p) => a + p.length, 0))
  let at = 0
  for (const p of parts) {
    out.set(p, at)
    at += p.length
  }
  return out
}
const el = (id: number[], body: Uint8Array, sizeLen = 1) => {
  const size = encodeSize(body.length, sizeLen)
  if (!size) throw new Error('size')
  return cat(Uint8Array.from(id), size, body)
}
const float64 = (v: number) => {
  const b = new Uint8Array(8)
  new DataView(b.buffer).setFloat64(0, v)
  return b
}

/** EBML header + Segment + Info (+ Tracks/Cluster stubs), like MediaRecorder writes. */
function fakeWebm(
  opts: { withDuration?: number; unknownSegment?: boolean } = {},
) {
  const ebml = el(
    [0x1a, 0x45, 0xdf, 0xa3],
    bytes(0x42, 0x82, 0x84, 0x77, 0x65, 0x62, 0x6d),
  ) // DocType "webm"
  const scale = el([0x2a, 0xd7, 0xb1], bytes(0x0f, 0x42, 0x40)) // 1_000_000
  const app = el([0x4d, 0x80], new TextEncoder().encode('Chrome'))
  const kids = [scale, app]
  if (opts.withDuration !== undefined)
    kids.push(el([0x44, 0x89], float64(opts.withDuration)))
  const info = el([0x15, 0x49, 0xa9, 0x66], cat(...kids), 8)
  const tracks = el(
    [0x16, 0x54, 0xae, 0x6b],
    bytes(0xae, 0x83, 0xd7, 0x81, 0x01),
  )
  const cluster = el(
    [0x1f, 0x43, 0xb6, 0x75],
    bytes(0xe7, 0x81, 0x00, 0xa3, 0x84, 1, 2, 3, 4),
  )
  const body = cat(info, tracks, cluster)
  const segment = opts.unknownSegment
    ? cat(
        bytes(0x18, 0x53, 0x80, 0x67),
        bytes(0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff),
        body,
      )
    : el([0x18, 0x53, 0x80, 0x67], body, 4)
  return cat(ebml, segment)
}

describe('encodeSize', () => {
  it('writes the smallest vint and honours a minimum length', () => {
    expect(encodeSize(5)).toEqual(bytes(0x85))
    expect(encodeSize(5, 4)).toEqual(bytes(0x10, 0, 0, 5))
    expect(encodeSize(300)).toEqual(bytes(0x41, 0x2c))
    expect(encodeSize(127)).toEqual(bytes(0x40, 0x7f)) // 0xff is reserved for "unknown"
  })
})

describe('WebM duration patch', () => {
  it('adds a missing Duration to a Chrome-style file with unknown-size segment', () => {
    const file = fakeWebm({ unknownSegment: true })
    expect(readWebmDurationMs(file)).toBeNull()
    const patched = patchWebmHead(file, 41_250)
    expect(patched).not.toBeNull()
    expect(readWebmDurationMs(patched as Uint8Array)).toBeCloseTo(41_250)
    // Everything after the header is untouched, in order.
    const tail = file.subarray(file.length - 9)
    expect(
      (patched as Uint8Array).subarray((patched as Uint8Array).length - 9),
    ).toEqual(tail)
  })
  it('keeps a known segment size correct after growing Info', () => {
    const file = fakeWebm()
    const patched = patchWebmHead(file, 3000) as Uint8Array
    expect(readWebmDurationMs(patched)).toBeCloseTo(3000)
    expect(patched.length).toBe(file.length + 11)
    // Segment size (4-byte vint) grew by 11
    const segAt = file.findIndex(
      (_, i) =>
        file[i] === 0x18 && file[i + 1] === 0x53 && file[i + 2] === 0x80,
    )
    const read = (b: Uint8Array) =>
      ((b[segAt + 4] & 0x0f) << 24) |
      (b[segAt + 5] << 16) |
      (b[segAt + 6] << 8) |
      b[segAt + 7]
    expect(read(patched) - read(file)).toBe(11)
  })
  it('overwrites an existing Duration in place', () => {
    const file = fakeWebm({ withDuration: 1, unknownSegment: true })
    expect(readWebmDurationMs(file)).toBeCloseTo(1)
    const patched = patchWebmHead(file, 9999) as Uint8Array
    expect(patched.length).toBe(file.length)
    expect(readWebmDurationMs(patched)).toBeCloseTo(9999)
  })
  it('respects the timecode scale', () => {
    // 2_000_000 ns per tick → 1 tick = 2 ms; writing 10 s means 5000 ticks
    const ebml = el(
      [0x1a, 0x45, 0xdf, 0xa3],
      bytes(0x42, 0x82, 0x84, 0x77, 0x65, 0x62, 0x6d),
    )
    const scale = el([0x2a, 0xd7, 0xb1], bytes(0x1e, 0x84, 0x80)) // 2_000_000
    const info = el([0x15, 0x49, 0xa9, 0x66], scale, 8)
    const seg = cat(
      bytes(
        0x18,
        0x53,
        0x80,
        0x67,
        0x01,
        0xff,
        0xff,
        0xff,
        0xff,
        0xff,
        0xff,
        0xff,
      ),
      info,
    )
    const patched = patchWebmHead(cat(ebml, seg), 10_000) as Uint8Array
    expect(readWebmDurationMs(patched)).toBeCloseTo(10_000)
  })
  it('refuses bytes that are not a WebM header', () => {
    expect(patchWebmHead(bytes(1, 2, 3, 4, 5, 6, 7, 8), 1000)).toBeNull()
    expect(patchWebmHead(new Uint8Array(0), 1000)).toBeNull()
    expect(readWebmDurationMs(bytes(0, 0, 0))).toBeNull()
  })
  it('patches a Blob and leaves other containers alone', async () => {
    const file = fakeWebm({ unknownSegment: true })
    const fixed = await fixWebmDuration(
      new Blob([file], { type: 'video/webm' }),
      5000,
    )
    expect(fixed.type).toBe('video/webm')
    expect(
      readWebmDurationMs(new Uint8Array(await fixed.arrayBuffer())),
    ).toBeCloseTo(5000)
    const mp4 = new Blob([file], { type: 'video/mp4' })
    expect(await fixWebmDuration(mp4, 5000)).toBe(mp4)
    const junk = new Blob([bytes(9, 9, 9)], { type: 'video/webm' })
    expect(await fixWebmDuration(junk, 5000)).toBe(junk)
    const zero = new Blob([file], { type: 'video/webm' })
    expect(await fixWebmDuration(zero, 0)).toBe(zero)
  })
})
