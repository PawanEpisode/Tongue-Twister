import { useNavigate } from '@tanstack/react-router'
import { useCallback, useState } from 'react'
import { api } from './api'
import { neighbour } from './neighbour'
import type { Twister } from './api'

/**
 * "Next / previous" follows whatever list the user came from (Browse filters). Router state doesn't
 * survive a reload, so the ordered slugs live in sessionStorage; with no context we pick a random
 * twister of the same level (PRD 01 H11).
 */
const KEY = 'twister.context.v1'

export const browseContext = {
  set(slugs: string[]) {
    try {
      window.sessionStorage.setItem(KEY, JSON.stringify(slugs))
    } catch {
      /* fine: falls back to same-level random */
    }
  },
  get(): string[] {
    try {
      return JSON.parse(window.sessionStorage.getItem(KEY) ?? '[]') as string[]
    } catch {
      return []
    }
  },
}

export function useTwisterNavigation(twister: Twister) {
  const nav = useNavigate()
  const [failed, setFailed] = useState(false)

  const go = useCallback(
    async (delta: 1 | -1) => {
      let slug = neighbour(browseContext.get(), twister.slug, delta)
      if (!slug) {
        const page = await api
          .twisters({ difficulty: String(twister.difficulty) })
          .catch(() => null)
        if (!page) return setFailed(true)
        const others = page.results.filter((x) => x.slug !== twister.slug)
        slug = others[Math.floor(Math.random() * others.length)]?.slug
      }
      setFailed(false)
      if (slug) void nav({ to: '/twisters/$slug', params: { slug } })
    },
    [nav, twister.slug, twister.difficulty],
  )

  return { next: () => go(1), previous: () => go(-1), failed }
}
