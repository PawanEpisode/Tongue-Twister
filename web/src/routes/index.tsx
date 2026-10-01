import { Link, createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { Flame, Lightbulb, Mic, Skull, Sprout, Zap } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { motion, useReducedMotion } from 'motion/react'
import { FavoriteButton } from '#/components/progress/FavoriteButton'
import { MasteryBadge } from '#/components/progress/MasteryBadge'
import { ProgressStrip } from '#/components/progress/ProgressStrip'
import { StreakBanner } from '#/components/progress/StreakBanner'
import { WeeklyBoard } from '#/components/progress/WeeklyBoard'
import { DifficultyBadge } from '#/components/ui'
import { Badge } from '#/components/ui/badge'
import { Button } from '#/components/ui/button'
import { Card } from '#/components/ui/card'
import { useFlag } from '#/lib/flags'
import { useSummary } from '#/lib/progress/useSummary'
import { seo } from '#/lib/seo'
import { api } from '#/lib/api'
import { CategoryIcon } from '#/lib/categoryIcons'
import {
  CategoryCardSkeleton,
  ErrorState,
  Skeleton,
} from '#/components/feedback'

export const Route = createFileRoute('/')({
  head: () => seo({ title: 'Twister — Say it fast. Say it right.', path: '/' }),
  component: Home,
})

const LEVELS: {
  d: 1 | 2 | 3 | 4
  name: string
  Icon: LucideIcon
  className: string
  blurb: string
}[] = [
  {
    d: 1,
    name: 'Easy',
    Icon: Sprout,
    className: 'text-lime',
    blurb: 'Warm-up wobblers',
  },
  {
    d: 2,
    name: 'Medium',
    Icon: Zap,
    className: 'text-cyan',
    blurb: 'Classic crowd pleasers',
  },
  {
    d: 3,
    name: 'Hard',
    Icon: Flame,
    className: 'text-pink',
    blurb: 'Real tongue tanglers',
  },
  {
    d: 4,
    name: 'Insane',
    Icon: Skull,
    className: 'text-foreground',
    blurb: 'Only the brave',
  },
]

function Home() {
  const daily = useQuery({ queryKey: ['daily'], queryFn: api.daily })
  const cats = useQuery({ queryKey: ['categories'], queryFn: api.categories })
  const weeklyBoards = useFlag('weekly_boards')
  const generate = useFlag('generate_twister')
  const summary = useSummary()
  const reduceMotion = useReducedMotion()
  return (
    <div className="space-y-16">
      <div className="space-y-3 pt-2">
        <ProgressStrip />
        {summary.data && (
          <StreakBanner summary={summary.data} twisterSlug={daily.data?.slug} />
        )}
      </div>
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
          <p className="mt-5 max-w-xl text-lg text-muted-foreground">
            Speak into your mic and watch every word light up live. Classic and
            modern tongue twisters, four difficulty levels, scores, streaks and
            XP.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            {daily.data && (
              <Button
                asChild
                size="lg"
                className="gap-2 shadow-lg shadow-primary/30 transition-transform hover:scale-[1.03]"
              >
                <Link to="/twisters/$slug" params={{ slug: daily.data.slug }}>
                  <Mic className="size-5" aria-hidden />
                  Try today’s twister
                </Link>
              </Button>
            )}
            <Button asChild variant="outline" size="lg">
              <Link to="/twisters">Browse all</Link>
            </Button>
            {generate && (
              <Button asChild variant="outline" size="lg">
                <Link to="/generate">Make your own</Link>
              </Button>
            )}
          </div>
        </div>
        <motion.div
          animate={
            reduceMotion ? undefined : { y: [0, -12, 0], rotate: [-2, 2, -2] }
          }
          transition={{ repeat: Infinity, duration: 6 }}
        >
          <Card variant="glass" className="rounded-3xl p-7">
            <div className="text-xs font-semibold uppercase tracking-widest text-pink">
              Try this twister!
            </div>
            {daily.isPending ? (
              <div className="mt-4 space-y-3" aria-busy>
                <Skeleton className="h-6 w-full" />
                <Skeleton className="h-6 w-5/6" />
                <Skeleton className="mt-5 h-3 w-2/3" />
              </div>
            ) : daily.isError ? (
              <div role="alert" className="mt-3">
                <p className="text-muted-foreground">
                  Couldn’t load today’s twister.
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-3 rounded-lg"
                  onClick={() => void daily.refetch()}
                >
                  Try again
                </Button>
              </div>
            ) : (
              <>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <DifficultyBadge level={daily.data.difficulty} />
                  <MasteryBadge state={daily.data.mastery} />
                  <Badge
                    variant={daily.data.best_score != null ? 'lime' : 'outline'}
                  >
                    Best {daily.data.best_score ?? 'N/A'}
                  </Badge>
                  <FavoriteButton twister={daily.data} className="ml-auto" />
                </div>
                <p className="mt-2 line-clamp-4 font-display text-2xl leading-snug">
                  {daily.data.text}
                </p>
                {daily.data.tip && (
                  <p className="mt-4 flex items-start gap-2 text-sm text-muted-foreground">
                    <Lightbulb
                      className="mt-0.5 size-4 shrink-0 text-brand"
                      aria-hidden
                    />
                    {daily.data.tip}
                  </p>
                )}
              </>
            )}
          </Card>
        </motion.div>
      </section>

      {weeklyBoards && <WeeklyBoard />}

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
                className="glass block rounded-2xl p-5 hover:border-primary/60"
              >
                <l.Icon className={`size-8 ${l.className}`} aria-hidden />
                <div className="mt-2 font-display text-xl font-bold">
                  {l.name}
                </div>
                <div className="text-sm text-muted-foreground">{l.blurb}</div>
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
                      className="glass flex h-[7.5rem] items-center gap-4 rounded-2xl p-5 hover:border-primary/60"
                    >
                      <CategoryIcon
                        slug={c.slug}
                        className="size-8 shrink-0 text-brand"
                      />
                      <span className="min-w-0">
                        <span className="block truncate font-display text-lg font-bold">
                          {c.name}{' '}
                          <span className="text-sm font-normal text-muted-foreground">
                            · {c.count}
                          </span>
                        </span>
                        <span className="line-clamp-2 text-sm text-muted-foreground">
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
