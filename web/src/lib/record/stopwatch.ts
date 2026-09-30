/** Active recording time: counts only while running, so pauses (user, hidden tab, device loss) never add up. */
export type Stopwatch = {
  start: (now: number) => void
  pause: (now: number) => void
  resume: (now: number) => void
  elapsed: (now: number) => number
  reset: () => void
  running: () => boolean
}

export function createStopwatch(): Stopwatch {
  let acc = 0
  let since: number | null = null
  return {
    start(now) {
      acc = 0
      since = now
    },
    pause(now) {
      if (since !== null) acc += Math.max(0, now - since)
      since = null
    },
    resume(now) {
      if (since === null) since = now
    },
    elapsed: (now) => acc + (since !== null ? Math.max(0, now - since) : 0),
    reset() {
      acc = 0
      since = null
    },
    running: () => since !== null,
  }
}
