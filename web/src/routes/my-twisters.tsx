import { createFileRoute } from '@tanstack/react-router'
import GenerateGate from '#/components/generate/GenerateGate'
import MyTwistersScreen from '#/components/generate/MyTwistersScreen'
import { seo } from '#/lib/seo'

export const Route = createFileRoute('/my-twisters')({
  head: () =>
    seo({
      title: 'My twisters | Twister',
      path: '/my-twisters',
      description: 'The twisters you made.',
      noindex: true,
    }),
  component: MyTwistersPage,
})

function MyTwistersPage() {
  return (
    <GenerateGate title="My twisters">
      <MyTwistersScreen />
    </GenerateGate>
  )
}
