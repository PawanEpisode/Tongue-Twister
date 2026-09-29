import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { seo } from '#/lib/seo'
import { api } from '#/lib/api'
import { TwisterCard } from '#/components/ui'

type Search = {
  difficulty?: string
  category?: string
  origin?: string
  q?: string
}
export const Route = createFileRoute('/twisters/')({
  head: () =>
    seo({
      title: 'Browse tongue twisters — Easy to Insane | Twister',
      description:
        'Search 40+ classic and modern tongue twisters. Filter by difficulty, sound family (S, R, TH, P/B…) and origin, then practise out loud.',
      path: '/twisters',
    }),
  validateSearch: (s: Record<string, unknown>): Search => ({
    difficulty: s.difficulty ? String(s.difficulty) : undefined,
    category: s.category ? String(s.category) : undefined,
    origin: s.origin ? String(s.origin) : undefined,
    q: s.q ? String(s.q) : undefined,
  }),
  component: Browse,
})

const chip = (on: boolean) =>
  `rounded-full border px-4 py-1.5 text-sm transition-colors ${on ? 'border-brand bg-brand/20 text-white' : 'border-line text-white/60 hover:border-brand/50'}`

function Browse() {
  const s = Route.useSearch()
  const nav = useNavigate({ from: '/twisters/' })
  const [q, setQ] = useState(s.q ?? '')
  const set = (patch: Partial<Search>) =>
    nav({ search: (p) => ({ ...p, ...patch }) })
  const cats = useQuery({ queryKey: ['categories'], queryFn: api.categories })
  const list = useQuery({
    queryKey: ['twisters', s],
    queryFn: () =>
      api.twisters({
        difficulty: s.difficulty,
        category: s.category,
        origin: s.origin,
        search: s.q,
      }),
  })

  return (
    <div>
      <h1 className="text-4xl font-extrabold">Browse twisters</h1>
      <form
        className="mt-5"
        onSubmit={(e) => {
          e.preventDefault()
          set({ q: q || undefined })
        }}
      >
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search — try “peter” or “lorry”"
          className="glass w-full rounded-2xl px-5 py-3 outline-none focus:border-brand"
        />
      </form>
      <div className="mt-5 flex flex-wrap gap-2">
        <button
          className={chip(!s.difficulty)}
          onClick={() => set({ difficulty: undefined })}
        >
          All levels
        </button>
        {['Easy', 'Medium', 'Hard', 'Insane'].map((n, i) => (
          <button
            key={n}
            className={chip(s.difficulty === String(i + 1))}
            onClick={() => set({ difficulty: String(i + 1) })}
          >
            {n}
          </button>
        ))}
        <span className="mx-2 w-px bg-line" />
        <button
          className={chip(!s.origin)}
          onClick={() => set({ origin: undefined })}
        >
          Classic + Modern
        </button>
        <button
          className={chip(s.origin === 'classic')}
          onClick={() => set({ origin: 'classic' })}
        >
          Classic
        </button>
        <button
          className={chip(s.origin === 'modern')}
          onClick={() => set({ origin: 'modern' })}
        >
          Modern
        </button>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          className={chip(!s.category)}
          onClick={() => set({ category: undefined })}
        >
          Every sound
        </button>
        {cats.data?.map((c) => (
          <button
            key={c.slug}
            className={chip(s.category === c.slug)}
            onClick={() => set({ category: c.slug })}
          >
            {c.emoji} {c.name}
          </button>
        ))}
      </div>
      {list.isError && (
        <p className="mt-10 text-pink">
          Couldn’t reach the API. Is the Django server running?
        </p>
      )}
      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {list.data?.results.map((t, i) => (
          <TwisterCard key={t.slug} t={t} i={i} />
        ))}
      </div>
      {list.data && list.data.results.length === 0 && (
        <p className="mt-10 text-white/50">
          No twisters match — loosen a filter.
        </p>
      )}
    </div>
  )
}
