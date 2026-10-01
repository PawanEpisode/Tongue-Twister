import { Link } from '@tanstack/react-router'
import { useState } from 'react'
import { Button } from '#/components/ui/button'
import { classifyUnsubscribeError, unsubscribe } from '#/lib/reminders/api'

type State = 'ready' | 'working' | 'done' | 'invalid' | 'network' | 'error'

/** One-click unsubscribe. Nothing is sent until the button is pressed, so link scanners can't unsubscribe anyone. */
export default function UnsubscribeCard({ token }: { token: string }) {
  const [state, setState] = useState<State>('ready')

  const run = async () => {
    setState('working')
    try {
      await unsubscribe(token)
      setState('done')
    } catch (err) {
      setState(classifyUnsubscribeError(err))
    }
  }

  if (state === 'done')
    return (
      <Shell title="You’re unsubscribed">
        <p className="mt-2 text-muted-foreground">
          We won’t send you practice reminders any more. You can turn them back
          on any time under Account.
        </p>
        <Button asChild className="mt-6 px-6 py-3">
          <Link to="/">Back to Twister</Link>
        </Button>
      </Shell>
    )
  if (state === 'invalid')
    return (
      <Shell title="This link doesn’t work">
        <p className="mt-2 text-muted-foreground">
          It may be incomplete or out of date. Sign in and switch reminders off
          under Account, or use the link in a newer email.
        </p>
        <Button asChild className="mt-6 px-6 py-3">
          <Link to="/account">Open Account</Link>
        </Button>
      </Shell>
    )
  return (
    <Shell title="Stop practice reminders?">
      <p className="mt-2 text-muted-foreground">
        Press the button to stop the daily reminder emails.
      </p>
      <Button
        className="mt-6 px-6 py-3"
        disabled={state === 'working'}
        onClick={() => void run()}
      >
        {state === 'working' ? 'Unsubscribing…' : 'Unsubscribe'}
      </Button>
      <p
        role="status"
        aria-live="polite"
        className="mt-3 min-h-5 text-sm text-pink"
      >
        {state === 'network' &&
          'We couldn’t reach Twister. Check your connection and try again.'}
        {state === 'error' && 'Something went wrong. Please try again.'}
      </p>
    </Shell>
  )
}

function Shell({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <div className="mx-auto max-w-md text-center">
      <h1 className="text-2xl font-bold">{title}</h1>
      {children}
    </div>
  )
}
