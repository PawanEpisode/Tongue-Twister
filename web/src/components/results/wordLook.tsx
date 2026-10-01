import { Check, EqualApproximately, Minus, X } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { WordStatus } from '#/lib/speak/similarity'

export type TargetStatus = Exclude<WordStatus, 'extra'>

/**
 * How each word outcome looks and is named. One table feeds the passage, the score bar and the
 * public score card, so colour, icon and screen-reader label never drift apart.
 * Colour is never the only cue: every status also has a label (and the chips an icon).
 */
export const WORD_LOOK: Record<
  TargetStatus,
  {
    Icon: LucideIcon
    label: string
    /** Legend wording, e.g. "30 right". */
    legend: string
    /** Icon tint (public chips). */
    className: string
    /** The word inside the "Read it back" passage. */
    word: string
    /** The score bar segment and legend dot. */
    swatch: string
  }
> = {
  correct: {
    Icon: Check,
    label: 'correct',
    legend: 'right',
    className: 'text-lime',
    word: 'text-foreground',
    swatch: 'bg-lime',
  },
  near: {
    Icon: EqualApproximately,
    label: 'close',
    legend: 'close',
    className: 'text-amber-500',
    word: 'bg-amber-500/20 text-amber-600',
    swatch: 'bg-amber-500',
  },
  wrong: {
    Icon: X,
    label: 'wrong',
    legend: 'off',
    className: 'text-pink',
    word: 'bg-pink/15 text-pink',
    swatch: 'bg-pink',
  },
  missed: {
    Icon: Minus,
    label: 'missed',
    legend: 'not heard',
    className: 'text-muted-foreground',
    word: 'text-muted-foreground/50',
    swatch: 'bg-muted-foreground/30',
  },
}

export const TARGET_STATUSES = ['correct', 'near', 'wrong', 'missed'] as const
