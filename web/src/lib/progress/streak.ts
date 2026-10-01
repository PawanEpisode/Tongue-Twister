import { plural } from './format'

/** Copy and small calculations for the streak UI. Kind and specific, never scolding (PRD 00 §2.8). */

export type MilestoneProgress = {
  /** 0–1 toward `target`. */
  fraction: number
  target: number
  remaining: number
}

/** How far the current streak is toward the next milestone; null once every milestone is behind. */
export function milestoneProgress(
  current: number,
  next: number | null,
): MilestoneProgress | null {
  if (next == null || next <= 0) return null
  const remaining = Math.max(0, next - current)
  return {
    fraction: Math.min(1, Math.max(0, current / next)),
    target: next,
    remaining,
  }
}

export function streakLabel(days: number): string {
  return days > 0 ? `${days}-day streak` : 'No streak yet'
}

export function milestoneCopy(current: number, next: number | null): string {
  const p = milestoneProgress(current, next)
  if (!p) return 'Every milestone reached — keep it going.'
  if (p.remaining === 0) return `${p.target}-day streak reached!`
  return `${plural(p.remaining, 'more day')} to a ${p.target}-day streak`
}

export function freezeCopy(freezes: number, max = 2): string {
  if (freezes <= 0)
    return 'No streak freezes banked. You earn one every 7 days of streak.'
  if (freezes >= max)
    return `${freezes} streak freezes banked (the most you can hold). Each covers one missed day.`
  return `${plural(freezes, 'streak freeze')} banked. It covers one missed day.`
}

/** The evening nudge: what is at stake, and what saves it. */
export function atRiskCopy(streak: number, freezes: number): string {
  const base = `Your ${streak}-day streak ends tonight`
  return freezes > 0
    ? `${base}. A freeze has your back, but one twister keeps it going.`
    : `${base}. One twister keeps it going.`
}
