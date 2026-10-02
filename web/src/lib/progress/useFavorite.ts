import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useState } from 'react'
import { api } from '../api'
import { useAuth } from '../auth'
import { GUEST_FAVORITES_EVENT, guestQueue } from '../syncQueue'

/** Lists that show a star; refetched after a change so they agree with the server. */
const FAVORITE_KEYS = [
  'twisters',
  'twister',
  'favorites',
  'summary',
  'my-twisters',
] as const

/** The on-device favourites, live: reacts to stars changed anywhere on the page. Empty on the server. */
export function useGuestFavorites(): string[] {
  const [slugs, setSlugs] = useState<string[]>([])
  useEffect(() => {
    const read = () => setSlugs(guestQueue.favorites())
    read()
    window.addEventListener(GUEST_FAVORITES_EVENT, read)
    return () => window.removeEventListener(GUEST_FAVORITES_EVENT, read)
  }, [])
  return slugs
}

/**
 * One favourite switch for every surface (cards, the hub header, lists). Signed in: optimistic, sends
 * the explicit target state (PUT/DELETE, so a double tap can't flip the wrong way), rolls back on error.
 * Guest: kept on-device until sign-up imports it (PRD 01 H6).
 *
 * `serverValue` is the twister's `is_favorite` from whichever list showed it.
 */
export function useFavorite(slug: string, serverValue: boolean) {
  const { session } = useAuth()
  const qc = useQueryClient()
  const signedIn = !!session
  const guestSlugs = useGuestFavorites()
  // The optimistic value wins until the refetch after a change confirms the server agrees.
  const [optimistic, setOptimistic] = useState<boolean | null>(null)

  const mutation = useMutation({
    mutationFn: (on: boolean) => api.setFavorite(slug, on),
    onError: () => setOptimistic(null), // rollback: fall back to what the server last said
    onSettled: async () => {
      await Promise.all(
        FAVORITE_KEYS.map((k) => qc.invalidateQueries({ queryKey: [k] })),
      )
      setOptimistic(null)
    },
  })

  const starred = signedIn
    ? (optimistic ?? serverValue)
    : guestSlugs.includes(slug)

  const { mutate } = mutation
  const set = useCallback(
    (on: boolean) => {
      if (signedIn) {
        setOptimistic(on)
        mutate(on)
      } else guestQueue.setFavorite(slug, on)
    },
    [signedIn, slug, mutate],
  )
  const toggle = useCallback(() => set(!starred), [set, starred])

  return {
    starred,
    toggle,
    set,
    failed: mutation.isError,
    /** Guests' stars live on this device only. */
    localOnly: !signedIn,
  }
}
