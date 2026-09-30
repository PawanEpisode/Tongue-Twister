import { Link, createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { motion } from 'motion/react'
import { seo } from '#/lib/seo'
import { api } from '#/lib/api'
import {
  CategoryCardSkeleton,
  ErrorState,
  Skeleton,
} from '#/components/feedback'

export const Route = createFileRoute('/')({
  head: () => seo({ title: 'Twister — Say it fast. Say it right.', path: '/' }),
  component: Home,
})

const LEVELS = [
  { d: 1, name: 'Easy', emoji: '🌱', blurb: 'Warm-up wobblers' },
  { d: 2, name: 'Medium', emoji: '⚡', blurb: 'Classic crowd pleasers' },
  { d: 3, name: 'Hard', emoji: '🔥', blurb: 'Real tongue tanglers' },
  { d: 4, name: 'Insane', emoji: '💀', blurb: 'Only the brave' },
]

function Home() {
  const daily = useQuery({ queryKey: ['daily'], queryFn: api.daily })
  const cats = useQuery({ queryKey: ['categories'], queryFn: api.categories })
  return (
    <div className="space-y-16">
      <section className="relative grid items-center gap-10 pt-6 md:grid-cols-[1.2fr_1fr]">
        <div>
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="mb-3 text-sm font-semibold uppercase tracking-widest text-brand"
          >
            Say it fast. Say it right.
          </motion.p>
          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-5xl font-extrabold leading-[1.05] md:text-7xl"
          >
            Can you say{' '}
            <span className="text-gradient">“red lorry, yellow lorry”</span> ten
            times?
          </motion.h1>
          <p className="mt-5 max-w-xl text-lg text-white/70">
            Speak into your mic and watch every word light up live. Classic and
            modern tongue twisters, four difficulty levels, scores, streaks and
            XP.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            {daily.data && (
              <Link
                to="/twisters/$slug"
                params={{ slug: daily.data.slug }}
                className="rounded-2xl bg-brand px-6 py-3.5 font-semibold shadow-lg shadow-brand/30 hover:scale-[1.03] transition-transform"
              >
                🎤 Try today’s twister
              </Link>
            )}
            <Link
              to="/twisters"
              className="rounded-2xl border border-line px-6 py-3.5 font-semibold hover:border-brand"
            >
              Browse all
            </Link>
          </div>
        </div>
        <motion.div
          animate={{ y: [0, -12, 0], rotate: [-2, 2, -2] }}
          transition={{ repeat: Infinity, duration: 6 }}
          className="glass rounded-3xl p-7"
        >
          <div className="text-xs font-semibold uppercase tracking-widest text-pink">
            Today’s twister
          </div>
          {daily.isPending ? (
            <div className="mt-4 space-y-3" aria-busy>
              <Skeleton className="h-6 w-full" />
              <Skeleton className="h-6 w-5/6" />
              <Skeleton className="mt-5 h-3 w-2/3" />
            </div>
          ) : daily.isError ? (
            <div role="alert" className="mt-3">
              <p className="text-white/70">Couldn’t load today’s twister.</p>
              <button
                onClick={() => void daily.refetch()}
                className="mt-3 rounded-lg border border-line px-3 py-1.5 text-sm hover:border-brand"
              >
                Try again
              </button>
            </div>
          ) : (
            <>
              <p className="mt-3 line-clamp-4 font-display text-2xl leading-snug">
                {daily.data.text}
              </p>
              {daily.data.tip && (
                <p className="mt-4 text-sm text-white/50">
                  💡 {daily.data.tip}
                </p>
              )}
            </>
          )}
        </motion.div>
      </section>

      <section>
        <h2 className="mb-5 text-2xl font-bold">Pick your level</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {LEVELS.map((l, i) => (
            <motion.div
              key={l.d}
              initial={{ opacity: 0, y: 14 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.06 }}
              whileHover={{ y: -4 }}
            >
              <Link
                to="/twisters"
                search={{ difficulty: String(l.d) }}
                className="glass block rounded-2xl p-5 hover:border-brand/60"
              >
                <div className="text-3xl">{l.emoji}</div>
                <div className="mt-2 font-display text-xl font-bold">
                  {l.name}
                </div>
                <div className="text-sm text-white/50">{l.blurb}</div>
              </Link>
            </motion.div>
          ))}
        </div>
      </section>

      <section>
        <h2 className="mb-5 text-2xl font-bold">Sound families</h2>
        {cats.isError ? (
          <ErrorState
            compact
            title="Couldn’t load sound families"
            error={cats.error}
            onRetry={() => void cats.refetch()}
          />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {cats.isPending
              ? Array.from({ length: 6 }, (_, i) => (
                  <CategoryCardSkeleton key={i} />
                ))
              : cats.data.map((c, i) => (
                  <motion.div
                    key={c.slug}
                    className="h-full"
                    initial={{ opacity: 0, y: 14 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true }}
                    transition={{ delay: i * 0.05 }}
                  >
                    <Link
                      to="/twisters"
                      search={{ category: c.slug }}
                      className="glass flex h-[7.5rem] items-center gap-4 rounded-2xl p-5 hover:border-brand/60"
                    >
                      <span className="text-3xl">{c.emoji}</span>
                      <span className="min-w-0">
                        <span className="block truncate font-display text-lg font-bold">
                          {c.name}{' '}
                          <span className="text-sm font-normal text-white/40">
                            · {c.count}
                          </span>
                        </span>
                        <span className="line-clamp-2 text-sm text-white/50">
                          {c.description}
                        </span>
                      </span>
                    </Link>
                  </motion.div>
                ))}
          </div>
        )}
      </section>
    </div>
  )
}
