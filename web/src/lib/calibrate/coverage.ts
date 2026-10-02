/** Pure helpers for the calibration page: what has been recorded, what to record next, how to find a twister. */
import { clipId } from './clip'
import type { GoldClip, Scenario } from './clip'

export type PickerTwister = {
  slug: string
  text: string
  difficulty: number
  difficulty_label: string
  focus_sounds: string[]
}

/** Takes kept for one speaker, twister and scenario. */
export const takesFor = (
  clips: readonly GoldClip[],
  speakerId: string,
  slug: string,
  scenario: Scenario,
) =>
  clips.filter(
    (c) =>
      c.speaker.id === speakerId &&
      c.twister.slug === slug &&
      c.scenario === scenario,
  ).length

/** slug → takes kept for this speaker and scenario. */
export function takeCounts(
  clips: readonly GoldClip[],
  speakerId: string,
  scenario: Scenario,
): Map<string, number> {
  const out = new Map<string, number>()
  for (const c of clips)
    if (c.speaker.id === speakerId && c.scenario === scenario)
      out.set(c.twister.slug, (out.get(c.twister.slug) ?? 0) + 1)
  return out
}

/**
 * The next twister (after `after`, wrapping round) this speaker has not yet recorded in this scenario, or null
 * when every twister is covered. Deleting a clip makes a take id reusable, so the id is the first free one.
 */
export function nextUnrecorded(
  slugs: readonly string[],
  clips: readonly GoldClip[],
  speakerId: string,
  scenario: Scenario,
  after?: string,
): string | null {
  const done = takeCounts(clips, speakerId, scenario)
  const start = after ? slugs.indexOf(after) + 1 : 0
  for (let i = 0; i < slugs.length; i++) {
    const slug = slugs[(start + i) % slugs.length]
    if (!done.has(slug)) return slug
  }
  return null
}

/** The first take number whose clip id is not already used, so removing a clip never causes a duplicate id. */
export function freeTake(
  clips: readonly GoldClip[],
  speakerId: string,
  slug: string,
  scenario: Scenario,
): number {
  const used = new Set(clips.map((c) => c.id))
  let take = 1
  while (used.has(clipId(speakerId, slug, scenario, take))) take++
  return take
}

/** Case-insensitive match on the slug, the words, and the focus sounds. Empty query keeps everything. */
export function filterTwisters(
  list: readonly PickerTwister[],
  q: string,
): PickerTwister[] {
  const terms = q.toLowerCase().split(/\s+/).filter(Boolean)
  if (!terms.length) return [...list]
  return list.filter((t) => {
    const hay = `${t.slug} ${t.text} ${t.focus_sounds.join(' ')}`.toLowerCase()
    return terms.every((term) => hay.includes(term))
  })
}

/** `m:ss` for the recording timer. */
export function clock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/** Clips grouped as slug → scenario → takes, newest twister first, for the session list. */
export function groupBySlug(clips: readonly GoldClip[]) {
  const map = new Map<string, GoldClip[]>()
  for (const c of clips)
    map.set(c.twister.slug, [...(map.get(c.twister.slug) ?? []), c])
  return [...map.entries()]
    .reverse()
    .map(([slug, list]) => ({ slug, clips: list }))
}
