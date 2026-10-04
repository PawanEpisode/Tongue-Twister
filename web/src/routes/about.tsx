import { createFileRoute } from '@tanstack/react-router'
import ProseLayout from '#/components/public/ProseLayout'
import { seo } from '#/lib/seo'

export const Route = createFileRoute('/about')({
  head: () =>
    seo({
      title: 'About Twister',
      description: 'Why Twister exists, who makes it and how scoring works.',
      path: '/about',
    }),
  component: About,
})

function About() {
  return (
    <ProseLayout title="About Twister">
      <p>
        Twister makes tongue-twister practice feel like a game with a coach: you
        say it, every word lights up, and you see what to fix next.
      </p>
      <h2>How scoring works</h2>
      <p>
        Your score combines how accurately you say each word with your speed for
        the level. After you sign in you also see the slow words and the sound
        that slipped.
      </p>
      <h2>Who makes it</h2>
      <p>
        Twister is made by Pawan. Say hello on{' '}
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
