import { useEffect, useRef } from 'react'

/** Radial, voice-reactive bars drawn from the live mic AnalyserNode (falls back to a gentle idle "breathing"). */
export default function AudioVisualizer({
  analyser,
  className = '',
}: {
  analyser: AnalyserNode | null
  className?: string
}) {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = ref.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    const size = canvas.clientWidth || 260
    canvas.width = size * dpr
    canvas.height = size * dpr
    ctx.scale(dpr, dpr)

    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const bins = analyser ? new Uint8Array(analyser.frequencyBinCount) : null
    const BARS = 72
    const half = BARS / 2
    const smooth = new Float32Array(BARS)
    const c = size / 2
    const r0 = size * 0.3
    const maxLen = size * 0.2
    let t = 0
    let raf = 0

    const draw = () => {
      raf = requestAnimationFrame(draw)
      t += 0.02
      ctx.clearRect(0, 0, size, size)
      if (analyser && bins) analyser.getByteFrequencyData(bins)
      let total = 0
      for (let i = 0; i < BARS; i++) {
        const k = i < half ? i : BARS - 1 - i // mirror → symmetric ring
        const raw = bins ? bins[2 + Math.floor((k / half) * 40)] / 255 : 0 // ≈ voice range
        const idle = reduce ? 0.05 : 0.05 + 0.03 * Math.sin(t * 2 + i * 0.5)
        smooth[i] += (Math.max(idle, Math.pow(raw, 1.25)) - smooth[i]) * 0.35
        total += smooth[i]
        const a = (i / BARS) * Math.PI * 2 - Math.PI / 2
        const len = smooth[i] * maxLen + 3
        ctx.strokeStyle = `hsl(${255 + (i / BARS) * 105} 92% ${62 + smooth[i] * 14}%)`
        ctx.lineWidth = Math.max(2.5, size * 0.016)
        ctx.lineCap = 'round'
        ctx.beginPath()
        ctx.moveTo(c + Math.cos(a) * r0, c + Math.sin(a) * r0)
        ctx.lineTo(c + Math.cos(a) * (r0 + len), c + Math.sin(a) * (r0 + len))
        ctx.stroke()
      }
      const avg = total / BARS
      const g = ctx.createRadialGradient(c, c, r0 * 0.4, c, c, r0 + maxLen)
      g.addColorStop(0, `rgba(139,107,255,${0.06 + avg * 0.55})`)
      g.addColorStop(1, 'rgba(139,107,255,0)')
      ctx.fillStyle = g
      ctx.beginPath()
      ctx.arc(c, c, r0 + maxLen, 0, Math.PI * 2)
      ctx.fill()
    }
    draw()
    return () => cancelAnimationFrame(raf)
  }, [analyser])

  return <canvas ref={ref} className={className} aria-hidden />
}
