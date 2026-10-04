import { createFileRoute } from '@tanstack/react-router'
import ProseLayout from '#/components/public/ProseLayout'
import { seo } from '#/lib/seo'

export const Route = createFileRoute('/privacy')({
  head: () =>
    seo({
      title: 'Privacy policy | Twister',
      description:
        'What Twister collects, what stays on your device, and how to delete your data.',
      path: '/privacy',
    }),
  component: Privacy,
})

// DRAFT for legal review before launch (docs/PRD-public-site.md section 12.2).
function Privacy() {
  return (
    <ProseLayout title="Privacy policy" updated="October 2026">
      <p>
        Twister is a tongue-twister practice app for people aged 13 and over.
        This page says plainly what we handle and why.
      </p>
      <h2>What we collect</h2>
      <ul>
        <li>
          Your account: email address and display name (and your Google profile
          name and photo if you sign in with Google).
        </li>
        <li>
          Your practice: the text of each attempt, its score, timing, streaks
          and favourites.
        </li>
        <li>Recordings, only if you press Record and choose to save a take.</li>
      </ul>
      <h2>What stays on your device</h2>
      <p>
        Your voice is not recorded unless you press Record and choose to save
        it. Before you create an account, your settings, favourites and any demo
        score stay in your browser.
      </p>
      <h2>Speech recognition</h2>
      <p>
        In some browsers, the browser’s built-in speech recognition may process
        audio using the browser maker’s service. Twister only receives the text
        and your score.
      </p>
      <h2>Analytics and error reports</h2>
      <p>
        With your consent we use PostHog for product analytics and Sentry for
        error reports. Events are a short fixed list (for example, that a
        practice started) and never include what you said or your email address.
      </p>
      <h2>Keeping and deleting your data</h2>
      <p>
        You can export your data and delete your account from Account. Deleting
        the account starts a 30-day grace period, after which your data is
        removed.
      </p>
      <h2>Age</h2>
      <p>Twister is for ages 13 and over.</p>
      <h2>Contact</h2>
      <p>
        You can reach the maker, Pawan, on{' '}
        <a
          href="https://www.linkedin.com/in/pawankumar1201"
          target="_blank"
          rel="noopener noreferrer"
        >
          LinkedIn
        </a>
        .
      </p>
    </ProseLayout>
  )
}
