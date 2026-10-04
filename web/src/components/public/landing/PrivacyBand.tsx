import { Link } from '@tanstack/react-router'
import { EyeOff, FileText, Trash2 } from 'lucide-react'
import { Reveal } from '#/components/public/motion/Reveal'
import { PRIVACY } from '#/content/landing'

const ICONS = [EyeOff, FileText, Trash2]

export default function PrivacyBand() {
  return (
    <section
      id="privacy"
      aria-labelledby="privacy-h"
      className="scroll-mt-20 py-16 sm:py-24"
    >
      <Reveal>
        <h2
          id="privacy-h"
          className="max-w-2xl text-4xl font-extrabold sm:text-5xl"
        >
          {PRIVACY.title}
        </h2>
      </Reveal>
      <div className="mt-10 grid gap-4 md:grid-cols-3">
        {PRIVACY.points.map((p, i) => {
          const Icon = ICONS[i]
          return (
            <Reveal key={p.title} delay={i * 0.06}>
              <div className="glass h-full rounded-3xl p-6">
                <Icon className="size-7 text-brand" aria-hidden />
                <h3 className="mt-4 text-lg font-bold">{p.title}</h3>
                <p className="mt-2 text-sm text-muted-foreground">{p.body}</p>
              </div>
            </Reveal>
          )
        })}
      </div>
      <p className="mt-6">
        <Link
          to="/privacy"
          className="text-sm font-semibold underline underline-offset-4"
        >
          Read the privacy policy
        </Link>
      </p>
    </section>
  )
}
