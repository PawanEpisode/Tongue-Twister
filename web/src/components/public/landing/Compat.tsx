import { useEffect, useState } from 'react'
import { Reveal } from '#/components/public/motion/Reveal'

const FAMILIES = ['S', 'SH', 'TH', 'R', 'L', 'P', 'B', 'K', 'F', 'W', 'CH', 'Z']

function detect(ua: string): string {
  if (/firefox/i.test(ua))
    return 'On Firefox you will use typed mode: live word-by-word needs Chrome, Edge or Safari.'
  if (/(chrome|crios|edg|safari)/i.test(ua))
    return 'You are on a browser that gives live word-by-word feedback. Everything works.'
  return 'Live word-by-word works in Chrome, Edge and Safari. Other browsers use typed mode.'
}

export default function Compat() {
  const [line, setLine] = useState(
    'Live word-by-word works in Chrome, Edge and Safari.',
  )
  useEffect(() => setLine(detect(navigator.userAgent)), [])
  return (
    <section
      aria-labelledby="where-h"
      className="grid items-center gap-10 py-16 sm:py-24 md:grid-cols-2"
    >
      <Reveal>
        <h2 id="where-h" className="text-4xl font-extrabold sm:text-5xl">
          Works where <span className="text-gradient">you are</span>.
        </h2>
        <p className="mt-4 text-muted-foreground">
          Live word-by-word in Chrome, Edge and Safari, on phones and laptops.
          On Firefox you will use typed mode.
        </p>
        <p className="mt-3 text-sm font-medium" role="status">
          {line}
        </p>
      </Reveal>
      <div
        aria-hidden
        className="relative mx-auto grid size-72 place-items-center sm:size-80"
      >
        {[0, 1].map((ring) => {
          const chips = FAMILIES.slice(ring * 6, ring * 6 + 6)
          const radius = ring === 0 ? 74 : 124
          return (
            <div
              key={ring}
              className="orbit absolute inset-0 grid place-items-center rounded-full"
              style={{
                animationDuration: `${ring === 0 ? 40 : 70}s`,
                animationDirection: ring === 0 ? 'normal' : 'reverse',
              }}
            >
              {chips.map((f, i) => {
                const deg = (360 / chips.length) * i
                return (
                  <span
                    key={f}
                    className="glass absolute grid size-9 place-items-center rounded-full text-xs font-bold"
                    style={{
                      transform: `rotate(${deg}deg) translateY(-${radius}px) rotate(-${deg}deg)`,
                    }}
                  >
                    {f}
                  </span>
                )
              })}
            </div>
          )
        })}
        <span className="font-display text-3xl font-extrabold text-gradient">
          Tw
        </span>
      </div>
    </section>
  )
}
