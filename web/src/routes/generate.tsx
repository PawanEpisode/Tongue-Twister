import { createFileRoute } from '@tanstack/react-router'
import GenerateForm from '#/components/generate/GenerateForm'
import GenerateGate from '#/components/generate/GenerateGate'
import { PageTitle } from '#/components/ui/page-title'
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
      <div className="mx-auto max-w-lg space-y-6">
        <PageTitle>Make a twister</PageTitle>
        <GenerateForm />
      </div>
    </GenerateGate>
  )
}
