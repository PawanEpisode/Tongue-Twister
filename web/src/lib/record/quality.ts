/** Resolution, bitrate, size estimates and the storage guard (PRD 04 §4.1, §6). Pure. */

export type Resolution = 'auto' | '720p' | '1080p'
export const FPS = 30
export const AUDIO_BPS = 128_000
/** Block a start when free space is under this many times the estimated file (PRD 04 §6 "Storage guard"). */
export const HEADROOM_FACTOR = 3

/** Long side / short side in pixels for a resolution choice ('auto' = 720p, the recording default). */
export function pixels(res: Resolution): { long: number; short: number } {
  return res === '1080p'
    ? { long: 1920, short: 1080 }
    : { long: 1280, short: 720 }
}

/** ~2 Mbps at 720p30, ~5 Mbps at 1080p30, scaled by pixel count for other shapes. */
export function videoBitrate(width: number, height: number, fps = FPS): number {
  const perPixel = 2_000_000 / (1280 * 720 * 30)
  const bps = width * height * fps * perPixel
  return Math.round(Math.min(6_000_000, Math.max(1_000_000, bps)) / 1000) * 1000
}

export const estimateBytes = (durationMs: number, videoBps: number): number =>
  Math.ceil(((videoBps + AUDIO_BPS) / 8) * (durationMs / 1000))

export type Headroom =
  { ok: true } | { ok: false; needBytes: number; freeBytes: number }

/** `estimate` comes from `navigator.storage.estimate()`; unknown quota never blocks. */
export function storageHeadroom(
  estimate: { quota?: number; usage?: number } | undefined,
  estimatedBytes: number,
): Headroom {
  if (!estimate || estimate.quota == null) return { ok: true }
  const free = Math.max(0, estimate.quota - (estimate.usage ?? 0))
  const need = estimatedBytes * HEADROOM_FACTOR
  return free < need
    ? { ok: false, needBytes: need, freeBytes: free }
    : { ok: true }
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`
}

/** 83_000 → "1:23". */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${String(s).padStart(2, '0')}`
}
