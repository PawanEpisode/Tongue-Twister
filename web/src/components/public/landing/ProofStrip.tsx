import { Marquee } from '#/components/public/motion/Marquee'
import type { LandingPayload } from '#/lib/api'

const firstWords = (t: string) =>
  t
    .split(/\s+/)
    .slice(0, 5)
    .join(' ')
    .replace(/[.,;:!?]+$/, '')

export default function ProofStrip({ data }: { data?: LandingPayload }) {
  const s = data?.stats
  const facts = [
    `${s?.twisters ?? 200}+ twisters`,
    `${s?.levels ?? 4} levels`,
    `${s?.categories ?? 6} sound families`,
    '3 practice modes',
  ]
  const snippets = (data?.teaser ?? []).map((t) => firstWords(t.text))
  return (
    <section aria-label="At a glance" className="space-y-6 py-10">
      <ul className="flex flex-wrap justify-center gap-x-8 gap-y-2 text-center font-display text-lg font-bold">
        {facts.map((f) => (
          <li key={f}>{f}</li>
        ))}
        {s?.practisers != null && (
          <li>
            Loved by {s.practisers.toLocaleString('en-US')} practisers
            {s.as_of ? ` (last 30 days)` : ''}
          </li>
        )}
      </ul>
      {snippets.length > 0 && (
        <Marquee label="A few of the twisters inside">
          {snippets.map((t, i) => (
            <span
              key={i}
              className="glass whitespace-nowrap rounded-full px-4 py-2 text-sm"
            >
              {t}…
            </span>
          ))}
        </Marquee>
      )}
    </section>
  )
}
