import { Link, createFileRoute } from '@tanstack/react-router'
import GenerateGate from '#/components/generate/GenerateGate'
import MyTwistersList from '#/components/generate/MyTwistersList'
import { Button } from '#/components/ui/button'
import { seo } from '#/lib/seo'

export const Route = createFileRoute('/my-twisters')({
  head: () =>
    seo({
      title: 'My twisters | Twister',
      description: 'The twisters you made.',
      path: '/my-twisters',
      noindex: true,
    }),
  component: MyTwistersPage,
})

function MyTwistersPage() {
  return (
    <GenerateGate title="My twisters">
      <div className="mx-auto max-w-3xl space-y-6 text-left">
        <div className="flex items-center justify-between gap-3">
          <h1 className="font-display text-3xl font-bold">My twisters</h1>
          <Button asChild variant="outline" size="sm">
            <Link to="/generate">Make another</Link>
          </Button>
        </div>
        <MyTwistersList />
      </div>
    </GenerateGate>
  )
}
