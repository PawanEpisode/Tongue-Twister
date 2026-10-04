import { ChevronDown } from 'lucide-react'
import { Reveal } from '#/components/public/motion/Reveal'
import { FAQ } from '#/content/landing'

/** Native <details>: keyboard and screen-reader support for free, and the answers are in the server HTML. */
export default function Faq() {
  return (
    <section
      id="faq"
      aria-labelledby="faq-h"
      className="scroll-mt-20 py-16 sm:py-24"
    >
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            '@context': 'https://schema.org',
            '@type': 'FAQPage',
            mainEntity: FAQ.map(([q, a]) => ({
              '@type': 'Question',
              name: q,
              acceptedAnswer: { '@type': 'Answer', text: a },
            })),
          }),
        }}
      />
      <Reveal>
        <h2 id="faq-h" className="text-4xl font-extrabold sm:text-5xl">
          Questions, <span className="text-gradient">answered</span>.
        </h2>
      </Reveal>
      <div className="mt-8 max-w-3xl divide-y divide-border rounded-3xl border border-border">
        {FAQ.map(([q, a]) => (
          <details key={q} className="group px-5 py-4">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-semibold">
              {q}
              <ChevronDown
                className="size-4 shrink-0 transition-transform group-open:rotate-180"
                aria-hidden
              />
            </summary>
            <p className="mt-2 text-muted-foreground">{a}</p>
          </details>
        ))}
      </div>
    </section>
  )
}
