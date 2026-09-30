import { useCallback, useEffect, useRef } from 'react'

const CLICK_HZ = 1000
const CLICK_S = 0.03
const MAX_GAIN = 0.3 // pref 1.0 → this gain; the default 0.5 keeps the original 0.15

/** One synthesised tick per word while running. Call `prime()` from a tap (autoplay policy). */
export function useMetronome({
  enabled,
  volume,
  index,
  running,
}: {
  enabled: boolean
  /** 0–1 */
  volume: number
  index: number
  running: boolean
}) {
  const ctx = useRef<AudioContext | null>(null)
  const level = useRef(volume) // read at tick time: moving the slider must not fire a tick
  level.current = volume

  const prime = useCallback(() => {
    if (!enabled || typeof AudioContext === 'undefined') return
    ctx.current ??= new AudioContext()
    if (ctx.current.state === 'suspended') void ctx.current.resume()
  }, [enabled])

  useEffect(() => {
    const c = ctx.current
    if (
      !enabled ||
      !running ||
      !c ||
      c.state !== 'running' ||
      level.current <= 0
    )
      return
    const osc = c.createOscillator()
    const gain = c.createGain()
    const t = c.currentTime
    osc.frequency.value = CLICK_HZ
    gain.gain.setValueAtTime(level.current * MAX_GAIN, t)
    gain.gain.exponentialRampToValueAtTime(0.001, t + CLICK_S)
    osc.connect(gain).connect(c.destination)
    osc.start(t)
    osc.stop(t + CLICK_S)
  }, [index, enabled, running])

  useEffect(() => () => void ctx.current?.close().catch(() => undefined), [])
  return { prime }
}
