/** Ticks at a steady rate independent of tab visibility. A Worker when available, a plain interval otherwise. */

export type FrameClock = {
  start: (fps: number, onTick: () => void) => void
  stop: () => void
}

export function createFrameClock(): FrameClock {
  let worker: Worker | null = null
  let interval: ReturnType<typeof setInterval> | undefined

  const stop = () => {
    worker?.terminate()
    worker = null
    if (interval !== undefined) clearInterval(interval)
    interval = undefined
  }

  return {
    start(fps, onTick) {
      stop()
      if (typeof Worker !== 'undefined') {
        try {
          worker = new Worker(
            new URL('./frameClock.worker.ts', import.meta.url),
            { type: 'module' },
          )
          worker.onmessage = onTick
          worker.postMessage({ type: 'start', fps })
          return
        } catch {
          worker = null // CSP or bundler quirk: use the main-thread fallback
        }
      }
      interval = setInterval(onTick, 1000 / fps)
    },
    stop,
  }
}
