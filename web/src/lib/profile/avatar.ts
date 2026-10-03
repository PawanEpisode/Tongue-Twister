import type { AvatarSource } from '#/lib/api'

/** A curated set for the picker; the API accepts any single emoji, so this is a convenience, not a rule. */
export const AVATAR_EMOJI_CHOICES = [
  '🗣️',
  '🎤',
  '🦜',
  '🐯',
  '🦊',
  '🐼',
  '🐙',
  '🦉',
  '🚀',
  '⚡',
  '🔥',
  '🌈',
  '🎯',
  '🏆',
  '🧠',
  '🎧',
  '🌟',
  '🍀',
  '🎸',
  '🦄',
  '🐢',
  '🐬',
  '🌻',
  '🍉',
] as const

export type AvatarView =
  | { kind: 'photo'; url: string }
  | { kind: 'emoji'; emoji: string }
  | { kind: 'initial'; letter: string }

/**
 * What to draw for a person. A photo is used only when it was chosen AND exists; otherwise the
 * emoji (when set) and finally the first letter of their name, so the avatar is never blank.
 */
export function resolveAvatar(input: {
  source?: AvatarSource
  photoUrl?: string
  emoji?: string
  name: string
}): AvatarView {
  const { source = 'photo', photoUrl, emoji, name } = input
  if (source === 'photo' && photoUrl) return { kind: 'photo', url: photoUrl }
  if (emoji?.trim()) return { kind: 'emoji', emoji: emoji.trim() }
  return { kind: 'initial', letter: [...name.trim()][0]?.toUpperCase() ?? '?' }
}
