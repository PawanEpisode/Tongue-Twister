import type { TimelineEvent } from '#/lib/api'

export type TimelineIcon =
  'sparkles' | 'trophy' | 'flame' | 'badge-check' | 'medal'

export type TimelineEntry = {
  icon: TimelineIcon
  title: string
  detail?: string
}

const str = (v: unknown): string | undefined =>
  typeof v === 'string' && v ? v : undefined
const num = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) ? v : undefined

/** "she-sells-seashells" → "she sells seashells". */
const nice = (slug: string) => slug.replace(/-/g, ' ')

/** What to say about one event. Tolerates missing or odd data (events are written by older and newer code). */
export function describeEvent(event: TimelineEvent): TimelineEntry {
  const d = event.data
  switch (event.kind) {
    case 'level_up':
      return { icon: 'sparkles', title: `Reached level ${num(d.level) ?? '—'}` }
    case 'achievement':
      return {
        icon: 'badge-check',
        title: `Unlocked ${str(d.name) ?? 'an achievement'}`,
        detail: str(d.tier),
      }
    case 'streak_milestone':
      return { icon: 'flame', title: `${num(d.days) ?? '—'}-day streak` }
    case 'twister_mastered':
      return {
        icon: 'medal',
        title: 'Mastered a twister',
        detail: str(d.twister) && nice(str(d.twister)!),
      }
    case 'personal_best':
      return {
        icon: 'trophy',
        title: `New personal best${num(d.score) != null ? `: ${num(d.score)}` : ''}`,
        detail: str(d.twister) && nice(str(d.twister)!),
      }
    default:
      return { icon: 'sparkles', title: 'Something happened' }
  }
}

/** Groups events by calendar day (viewer's locale), keeping the incoming newest-first order. */
export function groupByDay(
  events: readonly TimelineEvent[],
  now = new Date(),
): { label: string; events: TimelineEvent[] }[] {
  const groups: { key: string; label: string; events: TimelineEvent[] }[] = []
  const dayKey = (d: Date) =>
    `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  for (const event of events) {
    const date = new Date(event.created_at)
    const key = dayKey(date)
    let group = groups.find((g) => g.key === key)
    if (!group) {
      group = {
        key,
        label:
          key === dayKey(now)
            ? 'Today'
            : key === dayKey(yesterday)
              ? 'Yesterday'
              : date.toLocaleDateString(undefined, {
                  month: 'short',
                  day: 'numeric',
                  year:
                    date.getFullYear() === now.getFullYear()
                      ? undefined
                      : 'numeric',
                }),
        events: [],
      }
      groups.push(group)
    }
    group.events.push(event)
  }
  return groups.map(({ label, events: list }) => ({ label, events: list }))
}
