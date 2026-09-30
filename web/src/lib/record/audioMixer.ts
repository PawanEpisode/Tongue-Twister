/**
 * One Web Audio graph is the single audio clock for a take (PRD 04 edge case 16): mic (and tab/system
 * audio when present) → gain → MediaStreamDestination, with an analyser for the level meter.
 */

/** RMS 0–1 of byte time-domain data (128 = silence). */
export function rmsFromBytes(data: ArrayLike<number>): number {
  if (!data.length) return 0
  let sum = 0
  for (let i = 0; i < data.length; i++) {
    const v = (data[i] - 128) / 128
    sum += v * v
  }
  return Math.sqrt(sum / data.length)
}

export type AudioMixer = {
  /** The mixed audio track; null when no input had audio. */
  track: MediaStreamTrack | null
  analyser: AnalyserNode
  /** Current mic level 0–1. */
  level: () => number
  setGain: (gain: number) => void
  /** Plug in a replacement input, e.g. a microphone that was unplugged and came back. */
  addInput: (stream: MediaStream) => void
  resume: () => Promise<void>
  dispose: () => void
}

type ContextCtor = new () => AudioContext

export function audioContextCtor(): ContextCtor | null {
  const g = globalThis as {
    AudioContext?: ContextCtor
    webkitAudioContext?: ContextCtor
  }
  return g.AudioContext ?? g.webkitAudioContext ?? null
}

export function createAudioMixer(
  inputs: readonly MediaStream[],
  Ctor: ContextCtor | null = audioContextCtor(),
): AudioMixer {
  if (!Ctor)
    throw new DOMException('Web Audio unavailable', 'NotSupportedError')
  const ctx = new Ctor()
  const gain = ctx.createGain()
  const destination = ctx.createMediaStreamDestination()
  const analyser = ctx.createAnalyser()
  analyser.fftSize = 512
  analyser.smoothingTimeConstant = 0.6
  const sources: MediaStreamAudioSourceNode[] = []
  const addInput = (stream: MediaStream) => {
    if (!stream.getAudioTracks().length) return
    const src = ctx.createMediaStreamSource(stream)
    src.connect(gain)
    sources.push(src)
  }
  inputs.forEach(addInput)
  const hasAudio = sources.length > 0
  gain.connect(destination)
  gain.connect(analyser) // metering only; the analyser is not connected to speakers (no echo)
  const buffer = new Uint8Array(analyser.fftSize)

  return {
    track: hasAudio ? (destination.stream.getAudioTracks()[0] ?? null) : null,
    analyser,
    level() {
      analyser.getByteTimeDomainData(buffer)
      return rmsFromBytes(buffer)
    },
    addInput,
    setGain(value) {
      gain.gain.value = Math.max(0, Math.min(2, value))
    },
    resume: () => ctx.resume(),
    dispose() {
      sources.forEach((s) => s.disconnect())
      gain.disconnect()
      destination.stream.getTracks().forEach((t) => t.stop())
      void ctx.close().catch(() => undefined)
    },
  }
}
