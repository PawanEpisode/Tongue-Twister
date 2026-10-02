/**
 * In-browser benchmark (docs/features/13 section 8): load time, latency per second of audio and a 15 s estimate for
 * this device, from the same worker and model the app uses. Memory comes from `performance.memory` where the browser
 * has it (Chromium); it is a coarse upper bound on the JS heap, not the WASM heap, and is labelled as such.
 */
import { benchClip } from '../speak/engine/runtime/deviceGate'
import { deviceClass } from './clip'
import type { Speaker } from './clip'

export type BenchmarkResult = {
  clipSeconds: number[]
  runsMs: number[]
  perSecondMs: number
  estimate15sMs: number
  loadMs: number | null
  threads: number
  hardwareConcurrency: number
  deviceMemoryGB: number | null
  jsHeapMB: number | null
  deviceClass: Speaker['device_class']
  userAgent: string
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b)
  return s.length % 2
    ? s[(s.length - 1) / 2]
    : (s[s.length / 2 - 1] + s[s.length / 2]) / 2
}

export async function runBenchmark(
  run: (samples: Float32Array) => Promise<{ ms: number }>,
  env: {
    loadMs: number | null
    threads: number
    hardwareConcurrency: number
    deviceMemoryGB: number | null
    jsHeapMB: number | null
    userAgent: string
    touch: boolean
  },
  lengths: readonly number[] = [3, 8, 15],
  repeats = 3,
): Promise<BenchmarkResult> {
  await run(benchClip(1)) // warm-up: the first run pays one-off costs the app already paid at start-up
  const runsMs: number[] = []
  const perSecond: number[] = []
  for (const seconds of lengths) {
    const ms: number[] = []
    for (let i = 0; i < repeats; i++)
      ms.push((await run(benchClip(seconds))).ms)
    const m = median(ms)
    runsMs.push(Math.round(m))
    perSecond.push(m / seconds)
  }
  const perSecondMs = median(perSecond)
  return {
    clipSeconds: [...lengths],
    runsMs,
    perSecondMs: Math.round(perSecondMs),
    estimate15sMs: Math.round(perSecondMs * 15),
    loadMs: env.loadMs,
    threads: env.threads,
    hardwareConcurrency: env.hardwareConcurrency,
    deviceMemoryGB: env.deviceMemoryGB,
    jsHeapMB: env.jsHeapMB,
    deviceClass: deviceClass(env.userAgent, env.touch),
    userAgent: env.userAgent,
  }
}
