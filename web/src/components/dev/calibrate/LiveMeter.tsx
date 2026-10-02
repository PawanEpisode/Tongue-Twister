import { useEffect, useRef } from 'react'

/**
 * A scrolling level history drawn from the live mic. It is the proof the page can hear you: flat means silence,
 * bars rising means voice. `onHeard` fires once, the first time real signal arrives.
 */
export default function LiveMeter({
  analyser,
  onHeard,
}: {
  analyser: AnalyserNode
  onHeard: () => void
}) {
  const ref = useRef<HTMLCanvasElement>(null)
  const heard = useRef(onHeard)
  heard.current = onHeard

  useEffect(() => {
    const canvas = ref.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    const w = canvas.clientWidth || 360
    const h = canvas.clientHeight || 72
    canvas.width = w * dpr
    canvas.height = h * dpr
    ctx.scale(dpr, dpr)
    const GAP = 3
    const BAR = 4
    const n = Math.floor(w / (BAR + GAP))
    const history = new Array<number>(n).fill(0)
    const buf = new Float32Array(analyser.fftSize)
    const style = getComputedStyle(canvas)
    const color = style.getPropertyValue('--color-pink').trim() || '#f973c0'
    let fired = false
    let last = 0
    let raf = 0
    const draw = (now: number) => {
      raf = requestAnimationFrame(draw)
      if (now - last < 45) return // ~22 fps scroll is plenty and cheap
      last = now
      analyser.getFloatTimeDomainData(buf)
      let sum = 0
      for (const v of buf) sum += v * v
      const level = Math.min(1, Math.sqrt(sum / buf.length) * 5)
      history.push(level)
      history.shift()
      if (!fired && level > 0.12) {
        fired = true
        heard.current()
      }
      ctx.clearRect(0, 0, w, h)
      ctx.fillStyle = color
      history.forEach((l, i) => {
        const bar = Math.max(3, l * h)
        ctx.globalAlpha = 0.35 + (i / n) * 0.65
        ctx.beginPath()
        ctx.roundRect(i * (BAR + GAP), (h - bar) / 2, BAR, bar, 2)
        ctx.fill()
      })
    }
    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [analyser])

  return <canvas ref={ref} aria-hidden className="h-[72px] w-full" />
}
