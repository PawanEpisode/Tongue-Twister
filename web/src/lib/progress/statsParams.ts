import type { StatsMode, StatsRange } from '../api'

export const STATS_RANGES: readonly StatsRange[] = ['7d', '30d', '90d', 'all']
export const DEFAULT_RANGE: StatsRange = '30d'
export const STATS_MODES: readonly StatsMode[] = [
  'speak_score',
  'read_along',
  'record',
]

export const RANGE_LABELS: Record<StatsRange, string> = {
  '7d': '7 days',
  '30d': '30 days',
  '90d': '90 days',
  all: 'All time',
}
export const MODE_LABELS: Record<StatsMode, string> = {
  speak_score: 'Speak & score',
  read_along: 'Read-along',
  record: 'Record',
}

export const parseRange = (v: unknown): StatsRange =>
  STATS_RANGES.find((r) => r === v) ?? DEFAULT_RANGE

export const parseMode = (v: unknown): StatsMode | undefined =>
  STATS_MODES.find((m) => m === v)
