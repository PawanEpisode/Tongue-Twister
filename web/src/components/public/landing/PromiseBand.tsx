import { ScrollText } from '#/components/public/motion/ScrollText'
import { PROMISE } from '#/content/landing'

export default function PromiseBand() {
  return (
    <section className="py-20 sm:py-28">
      <ScrollText
        text={PROMISE}
        className="mx-auto max-w-4xl font-display text-4xl leading-tight font-extrabold sm:text-6xl"
      />
    </section>
  )
}
