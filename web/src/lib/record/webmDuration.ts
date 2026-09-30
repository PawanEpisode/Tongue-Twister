/**
 * Chrome's MediaRecorder writes WebM without a Duration, so players show "0:00 / ∞" and can't seek.
 * This patches the header only (a few KB): it finds Segment → Info and sets or inserts the Duration
 * element, then re-joins the untouched rest of the file. Pure byte work, no libraries.
 */

const ID_EBML = 0x1a45dfa3
const ID_SEGMENT = 0x18538067
const ID_INFO = 0x1549a966
const ID_TIMECODE_SCALE = 0x2ad7b1
const ID_DURATION = 0x4489
const HEAD_BYTES = 64 * 1024

type Vint = { value: number; length: number; unknown: boolean }

/** Element ID: keeps its length-marker bits, as the spec writes IDs. */
function readId(b: Uint8Array, at: number): Vint | null {
  const first = b[at]
  if (first === undefined || first === 0) return null
  const length = Math.clz32(first) - 24 + 1
  if (length > 4 || at + length > b.length) return null
  let value = 0
  for (let i = 0; i < length; i++) value = value * 256 + b[at + i]
  return { value, length, unknown: false }
}

/** Data size: marker bit removed; all-ones = "unknown size" (live streams, i.e. MediaRecorder). */
function readSize(b: Uint8Array, at: number): Vint | null {
  const first = b[at]
  if (first === undefined || first === 0) return null
  const length = Math.clz32(first) - 24 + 1
  if (length > 8 || at + length > b.length) return null
  let value = first & (0xff >> length)
  let allOnes = value === 0xff >> length
  for (let i = 1; i < length; i++) {
    value = value * 256 + b[at + i]
    if (b[at + i] !== 0xff) allOnes = false
  }
  return { value, length, unknown: allOnes }
}

/** Smallest vint that holds `value`, or exactly `minLength` bytes when it fits (keeps sizes stable). */
export function encodeSize(value: number, minLength = 1): Uint8Array | null {
  for (let length = Math.max(1, minLength); length <= 8; length++) {
    // The all-ones pattern is reserved for "unknown".
    if (value < 2 ** (7 * length) - 1) {
      const out = new Uint8Array(length)
      let v = value
      for (let i = length - 1; i >= 0; i--) {
        out[i] = v % 256
        v = Math.floor(v / 256)
      }
      out[0] |= 1 << (8 - length)
      return out
    }
  }
  return null
}

type Element = {
  id: number
  start: number
  idLen: number
  sizeLen: number
  bodyStart: number
  size: number
  unknown: boolean
}

function readElement(b: Uint8Array, at: number): Element | null {
  const id = readId(b, at)
  if (!id) return null
  const size = readSize(b, at + id.length)
  if (!size) return null
  return {
    id: id.value,
    start: at,
    idLen: id.length,
    sizeLen: size.length,
    bodyStart: at + id.length + size.length,
    size: size.value,
    unknown: size.unknown,
  }
}

function findInfo(b: Uint8Array): { segment: Element; info: Element } | null {
  const ebml = readElement(b, 0)
  if (!ebml || ebml.id !== ID_EBML) return null
  const segment = readElement(b, ebml.bodyStart + ebml.size)
  if (!segment || segment.id !== ID_SEGMENT) return null
  let at = segment.bodyStart
  while (at < b.length) {
    const el = readElement(b, at)
    if (!el) return null
    if (el.id === ID_INFO) return { segment, info: el }
    if (el.unknown) return null
    at = el.bodyStart + el.size
  }
  return null
}

function readFloat(b: Uint8Array, at: number, size: number): number | null {
  const view = new DataView(b.buffer, b.byteOffset + at, size)
  return size === 4
    ? view.getFloat32(0)
    : size === 8
      ? view.getFloat64(0)
      : null
}

function infoChildren(b: Uint8Array, info: Element): Element[] {
  const out: Element[] = []
  let at = info.bodyStart
  const end = info.bodyStart + info.size
  while (at < end) {
    const el = readElement(b, at)
    if (!el || el.unknown) break
    out.push(el)
    at = el.bodyStart + el.size
  }
  return out
}

function timecodeScale(b: Uint8Array, kids: Element[]): number {
  const el = kids.find((k) => k.id === ID_TIMECODE_SCALE)
  if (!el) return 1_000_000 // spec default: 1 ms per tick
  let v = 0
  for (let i = 0; i < el.size; i++) v = v * 256 + b[el.bodyStart + i]
  return v || 1_000_000
}

/** Duration in ms if the header has one (used by tests and to skip files that are already fine). */
export function readWebmDurationMs(head: Uint8Array): number | null {
  const found = findInfo(head)
  if (!found) return null
  const kids = infoChildren(head, found.info)
  const d = kids.find((k) => k.id === ID_DURATION)
  if (!d) return null
  const ticks = readFloat(head, d.bodyStart, d.size)
  return ticks === null ? null : (ticks * timecodeScale(head, kids)) / 1_000_000
}

/**
 * Returns a copy of `head` with Duration set to `durationMs`, or null when the bytes aren't a WebM header
 * we understand (the caller then keeps the original blob untouched).
 */
export function patchWebmHead(
  head: Uint8Array,
  durationMs: number,
): Uint8Array<ArrayBuffer> | null {
  const found = findInfo(head)
  if (!found) return null
  const { segment, info } = found
  const infoEnd = info.bodyStart + info.size
  if (infoEnd > head.length) return null
  const kids = infoChildren(head, info)
  const ticks = (durationMs * 1_000_000) / timecodeScale(head, kids)
  const existing = kids.find((k) => k.id === ID_DURATION)

  if (existing) {
    const out = head.slice()
    const view = new DataView(out.buffer)
    if (existing.size === 4) view.setFloat32(existing.bodyStart, ticks)
    else if (existing.size === 8) view.setFloat64(existing.bodyStart, ticks)
    else return null
    return out
  }

  // Duration: ID (2) + size vint 0x88 (1) + float64 (8) = 11 bytes appended to Info.
  const el = new Uint8Array(11)
  el[0] = 0x44
  el[1] = 0x89
  el[2] = 0x88
  new DataView(el.buffer).setFloat64(3, ticks)
  const newInfoSize = encodeSize(info.size + el.length, info.sizeLen)
  if (!newInfoSize) return null
  const delta = el.length + (newInfoSize.length - info.sizeLen)

  let segmentSize: Uint8Array | null = null
  if (!segment.unknown) {
    segmentSize = encodeSize(segment.size + delta, segment.sizeLen)
    if (!segmentSize || segmentSize.length !== segment.sizeLen) return null
  }

  const parts: Uint8Array[] = []
  const seg = segmentSize
    ? [head.subarray(0, segment.start + segment.idLen), segmentSize]
    : [head.subarray(0, segment.bodyStart)]
  parts.push(...seg)
  parts.push(head.subarray(segment.bodyStart, info.start + info.idLen))
  parts.push(newInfoSize)
  parts.push(head.subarray(info.bodyStart, infoEnd))
  parts.push(el)
  parts.push(head.subarray(infoEnd))

  const total = parts.reduce((n, p) => n + p.length, 0)
  const out = new Uint8Array(total)
  let at = 0
  for (const p of parts) {
    out.set(p, at)
    at += p.length
  }
  return out
}

/** A WebM blob with a real duration; anything that isn't a patchable WebM comes back unchanged. */
export async function fixWebmDuration(
  blob: Blob,
  durationMs: number,
): Promise<Blob> {
  if (durationMs <= 0 || !/webm/i.test(blob.type)) return blob
  const head = new Uint8Array(await blob.slice(0, HEAD_BYTES).arrayBuffer())
  const patched = patchWebmHead(head, durationMs)
  if (!patched) return blob
  return new Blob([patched, blob.slice(head.length)], { type: blob.type })
}
