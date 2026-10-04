import { createFileRoute } from '@tanstack/react-router'
import ProseLayout from '#/components/public/ProseLayout'
import { seo } from '#/lib/seo'

export const Route = createFileRoute('/terms')({
  head: () =>
    seo({
      title: 'Terms of use | Twister',
      description: 'The rules for using Twister.',
      path: '/terms',
    }),
  component: Terms,
})

// DRAFT for legal review before launch (docs/PRD-public-site.md section 12.2).
function Terms() {
  return (
    <ProseLayout title="Terms of use" updated="October 2026">
      <p>By using Twister you agree to these terms.</p>
      <h2>Who can use it</h2>
      <p>You must be 13 or older.</p>
      <h2>Acceptable use</h2>
      <p>
        Do not abuse the service, try to break it, scrape it at scale, or use it
        to harass anyone.
      </p>
      <h2>Your content</h2>
      <p>
        Recordings you choose to save remain yours. You give Twister permission
        to store and play them back to you, and to share them only when you
        create a share link.
      </p>
      <h2>Scores</h2>
      <p>
        Scores are a practice aid, not a measure of any qualification. They can
        be wrong.
      </p>
      <h2>No warranty</h2>
      <p>Twister is provided as is, without warranties of any kind.</p>
      <h2>Ending your account</h2>
      <p>
        You can delete your account at any time. We may suspend accounts that
        break these terms.
      </p>
    </ProseLayout>
  )
}
