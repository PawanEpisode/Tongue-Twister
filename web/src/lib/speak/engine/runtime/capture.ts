/**
 * Raw PCM tap on the microphone stream the recogniser already opened. The Web Speech API gives no audio, so the
 * Accurate-mode engine listens to the same stream with an AudioWorklet, buffers it in memory only (nothing leaves
 * the device unless the user is spot-checked), and hands back 16 kHz mono when the take ends.
 */
import { SAMPLE_RATE } from './chunking'
import { resample } from './resample'

/** The longest take we keep: matches the voice-clip cap (60 s) so an upload can never be refused for length. */
export const MAX_CAPTURE_SECONDS = 60

export class PcmBuffer {
  private chunks: Float32Array[] = []
  private length = 0
  truncated = false

  constructor(private readonly maxSamples: number) {}

  push(chunk: Float32Array) {
    if (this.length >= this.maxSamples) {
      this.truncated = true
      return
    }
    const room = this.maxSamples - this.length
    const take = chunk.length > room ? chunk.subarray(0, room) : chunk
    if (take.length < chunk.length) this.truncated = true
    this.chunks.push(new Float32Array(take)) // the worklet reuses its buffers; always copy
    this.length += take.length
  }

  get samples() {
    return this.length
  }

  toFloat32(): Float32Array {
    const out = new Float32Array(this.length)
    let at = 0
    for (const c of this.chunks) {
      out.set(c, at)
      at += c.length
    }
    return out
  }

  clear() {
    this.chunks = []
    this.length = 0
    this.truncated = false
  }
}

export type Captured = {
  /** 16 kHz mono, whatever the microphone ran at. */
  samples: Float32Array
  /** The hardware rate (feeds the sample-rate quality gate). */
  captureRate: number
  truncated: boolean
}

/** Finish a take: resample the buffered PCM to 16 kHz. */
export function finishCapture(
  buffer: PcmBuffer,
  ctxRate: number,
  trackRate?: number | null,
): Captured {
  return {
    samples: resample(buffer.toFloat32(), ctxRate, SAMPLE_RATE),
    captureRate:
      trackRate && trackRate > 0 ? Math.min(trackRate, ctxRate) : ctxRate,
    truncated: buffer.truncated,
  }
}

export interface PcmTap {
  /** Stop listening and return the take. Synchronous: it runs while the audio context is being torn down. */
  stop: () => Captured
  /** Stop listening and forget everything (cancelled take, unmount). */
  cancel: () => void
}

/**
 * Attach a worklet to `source` (the MediaStreamAudioSourceNode of the live mic). Returns null when the browser
 * has no AudioWorklet: the caller then simply stays on basic scoring for this take.
 */
export async function startPcmTap(
  ctx: AudioContext,
  source: MediaStreamAudioSourceNode,
  workletUrl: string,
  track?: MediaStreamTrack,
): Promise<PcmTap | null> {
  if (!ctx.audioWorklet || typeof AudioWorkletNode === 'undefined') return null
  try {
    await ctx.audioWorklet.addModule(workletUrl)
  } catch {
    return null
  }
  const buffer = new PcmBuffer(Math.floor(MAX_CAPTURE_SECONDS * ctx.sampleRate))
  const node = new AudioWorkletNode(ctx, 'twister-pcm-tap', {
    numberOfInputs: 1,
    numberOfOutputs: 0,
    channelCount: 1,
    channelCountMode: 'explicit',
  })
  node.port.onmessage = (e: MessageEvent<Float32Array>) => buffer.push(e.data)
  source.connect(node)
  let done = false
  const detach = () => {
    done = true
    node.port.onmessage = null
    try {
      source.disconnect(node)
    } catch {
      /* already disconnected */
    }
    node.port.close()
  }
  return {
    stop() {
      if (!done) detach()
      return finishCapture(
        buffer,
        ctx.sampleRate,
        track?.getSettings?.().sampleRate,
      )
    },
    cancel() {
      if (!done) detach()
      buffer.clear()
    },
  }
}
