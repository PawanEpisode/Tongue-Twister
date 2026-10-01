import { createFileRoute } from '@tanstack/react-router'
import GenerateForm from '#/components/generate/GenerateForm'
import GenerateGate from '#/components/generate/GenerateGate'
import { seo } from '#/lib/seo'

export const Route = createFileRoute('/generate')({
  head: () =>
    seo({
      title: 'Make a twister | Twister',
      description: 'Make your own tongue twister from any topic.',
      path: '/generate',
      noindex: true,
    }),
  component: GeneratePage,
})

function GeneratePage() {
  return (
    <GenerateGate title="Make a twister">
      <div className="mx-auto max-w-2xl space-y-6">
        <h1 className="font-display text-3xl font-bold">Make a twister</h1>
        <GenerateForm />
      </div>
    </GenerateGate>
  )
}
