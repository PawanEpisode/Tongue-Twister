import { createFileRoute } from '@tanstack/react-router'
import UnsubscribeCard from '#/components/UnsubscribeCard'
import { seo } from '#/lib/seo'

export const Route = createFileRoute('/unsubscribe/$token')({
  head: () =>
    seo({
      title: 'Unsubscribe | Twister',
      description: 'Stop Twister practice reminder emails.',
      path: '/unsubscribe',
      noindex: true,
    }),
  component: UnsubscribePage,
})

function UnsubscribePage() {
  const { token } = Route.useParams()
  return <UnsubscribeCard token={token} />
}
