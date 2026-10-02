/**
 * AudioWorklet processor: copies each 128-frame render quantum of the mic's first channel to the main thread.
 * Runs in AudioWorkletGlobalScope, so it can import nothing and must stay tiny.
 */
declare class AudioWorkletProcessor {
  readonly port: MessagePort
}
declare function registerProcessor(
  name: string,
  ctor: new () => AudioWorkletProcessor,
): void

const BATCH = 1024 // frames per message: ~21 ms at 48 kHz (the unsent tail at stop is at most one batch)

class TwisterPcmTap extends AudioWorkletProcessor {
  private buf = new Float32Array(BATCH)
  private at = 0

  process(inputs: Float32Array[][]): boolean {
    const channel = inputs[0]?.[0]
    if (!channel) return true
    let i = 0
    while (i < channel.length) {
      const n = Math.min(channel.length - i, BATCH - this.at)
      this.buf.set(channel.subarray(i, i + n), this.at)
      this.at += n
      i += n
      if (this.at === BATCH) {
        this.port.postMessage(this.buf, [this.buf.buffer])
        this.buf = new Float32Array(BATCH)
        this.at = 0
      }
    }
    return true
  }
}

registerProcessor('twister-pcm-tap', TwisterPcmTap)
