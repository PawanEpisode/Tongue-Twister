import type PostHogModule from 'posthog-js'
import { analyticsBlocked, setOptedOut } from './consent'
import { sanitise } from './events'
import type { EventName, EventProps } from './events'

/**
 * Product analytics via PostHog, loaded lazily and only when `VITE_POSTHOG_KEY` is set. Without the key
 * nothing is imported, no chunk is fetched and no request is made. Cookieless (memory persistence), no
 * autocapture, no replay, no pageview capture; Do-Not-Track and the in-app opt-out both stop everything.
 */
type PostHog = typeof PostHogModule
export type PostHogLoader = () => Promise<{ default: PostHog }>

const DEFAULT_HOST = 'https://eu.i.posthog.com'
const QUEUE_MAX = 20

let loader: PostHogLoader = () => import('posthog-js')
let client: PostHog | null = null
let starting: Promise<void> | null = null
let queue: [string, Record<string, string | number>][] = []

const env = () => import.meta.env as Record<string, string | undefined>
export const analyticsConfigured = () => !!env().VITE_POSTHOG_KEY

export function initAnalytics(): void {
  const key = env().VITE_POSTHOG_KEY
  if (!key || starting || typeof window === 'undefined' || analyticsBlocked())
    return
  const host = env().VITE_POSTHOG_HOST || DEFAULT_HOST
  starting = loader()
    .then(({ default: posthog }) => {
      if (analyticsBlocked()) return
      posthog.init(key, {
        api_host: host,
        persistence: 'memory',
        autocapture: false,
        capture_pageview: false,
        capture_pageleave: false,
        disable_session_recording: true,
        disable_surveys: true,
        respect_dnt: true,
        ip: false,
        person_profiles: 'identified_only',
        advanced_disable_flags: true,
      })
      client = posthog
      for (const [name, props] of queue) posthog.capture(name, props)
      queue = []
    })
    .catch(() => {
      starting = null // a blocked or failed load never breaks the app; the next init may retry
      queue = []
    })
}

/** Records one allow-listed event. Unknown events and properties are dropped; never throws. */
export function track<TName extends EventName>(
  name: TName,
  ...[props]: keyof EventProps[TName] extends never ? [] : [EventProps[TName]]
): void {
  try {
    if (!analyticsConfigured() || analyticsBlocked()) return
    const clean = sanitise(name, props)
    if (!clean) return
    if (client) client.capture(name, clean)
    else if (starting && queue.length < QUEUE_MAX) queue.push([name, clean])
  } catch {
    /* analytics must never break the app */
  }
}

/** The Privacy switch: remembers the choice and stops a running client at once. */
export function setAnalyticsOptOut(optOut: boolean): void {
  setOptedOut(optOut)
  if (optOut) {
    queue = []
    client?.opt_out_capturing()
    client?.reset()
  } else if (client) client.opt_in_capturing()
  else initAnalytics()
}

/** Test seams. */
export function __setLoader(l: PostHogLoader): void {
  loader = l
}
export function __reset(): void {
  client = null
  starting = null
  queue = []
  loader = () => import('posthog-js')
}
