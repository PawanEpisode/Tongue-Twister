import { createFileRoute, notFound } from '@tanstack/react-router'
import ScoreCardView from '#/components/ScoreCardView'
import { loadScoreCard, scoreCardHead } from '#/lib/scoreCard'

export const Route = createFileRoute('/s/$token')({
  // Loaded on the server so link-preview crawlers (which run no JS) see the og:* tags. A score card holds
  // no media and no personal data beyond the opt-in public name, so caching its HTML is harmless.
  loader: async ({ params }) => {
    const state = await loadScoreCard(params.token)
    // A token that never existed is a real HTTP 404 (TanStack Router sets it for `notFound()`). The router
    // has no way to answer 410/502/503, so those states are friendly pages with a 200 (always `noindex`).
    if (state.kind === 'missing') throw notFound()
    return state
  },
  head: ({ loaderData, params }) => scoreCardHead(loaderData, params.token),
  notFoundComponent: () => <ScoreCardView state={{ kind: 'missing' }} />,
  component: SharedScoreCard,
})

function SharedScoreCard() {
  return <ScoreCardView state={Route.useLoaderData()} />
}
