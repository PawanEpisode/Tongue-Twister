import { createFileRoute } from '@tanstack/react-router'
import ScoreCardView from '#/components/ScoreCardView'
import { loadScoreCard, scoreCardHead } from '#/lib/scoreCard'

export const Route = createFileRoute('/s/$token')({
  // Loaded on the server so link-preview crawlers (which run no JS) see the og:* tags. A score card holds
  // no media and no personal data beyond the opt-in public name, so caching its HTML is harmless.
  loader: ({ params }) => loadScoreCard(params.token),
  head: ({ loaderData, params }) => scoreCardHead(loaderData, params.token),
  component: SharedScoreCard,
})

function SharedScoreCard() {
  return <ScoreCardView state={Route.useLoaderData()} />
}
