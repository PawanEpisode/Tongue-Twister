import type { Captured } from '../speak/engine/runtime/capture'

export type Recorder = {
  /** Live mic level source for the meter. */
  analyser: AnalyserNode
  stop: () => Captured | null
  cancel: () => void
}

/**
 * The same constraints as the Speak screen: the gold set has to match what the engine hears in production.
 * The analyser only feeds the on-screen meter; it taps the same source and changes nothing that is captured.
 */
export async function startRecorder(): Promise<Recorder> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
  })
  const ctx = new AudioContext()
  await ctx.resume()
  const source = ctx.createMediaStreamSource(stream)
  const analyser = ctx.createAnalyser()
  analyser.fftSize = 1024
  source.connect(analyser)
  const { startTap } = await import('../speak/engine/runtime/tap')
  const tap = await startTap(ctx, source, stream.getAudioTracks()[0])
  const release = () => {
    stream.getTracks().forEach((t) => t.stop())
    void ctx.close().catch(() => undefined)
  }
  if (!tap) {
    release()
    throw new Error('This browser has no AudioWorklet.')
  }
  return {
    analyser,
    stop: () => {
      const captured = tap.stop()
      release()
      return captured
    },
    cancel: () => {
      tap.cancel()
      release()
    },
  }
}
