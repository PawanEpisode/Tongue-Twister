/**
 * Frame clock for the compositor. `requestAnimationFrame` stops in hidden tabs and a worker's timers
 * do not, so ticks come from here (PRD 04 §6 "Background-tab problem").
 */
type Command = { type: 'start'; fps: number } | { type: 'stop' }
type WorkerScope = {
  onmessage: ((e: MessageEvent<Command>) => void) | null
  postMessage: (message: 'tick') => void
}
const scope = self as unknown as WorkerScope
let timer: ReturnType<typeof setInterval> | undefined

scope.onmessage = (e) => {
  if (timer !== undefined) clearInterval(timer)
  timer = undefined
  if (e.data.type === 'start')
    timer = setInterval(() => scope.postMessage('tick'), 1000 / e.data.fps)
}
