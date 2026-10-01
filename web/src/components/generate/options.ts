/** Choices shared by the compose form and the recap shown after a twister is made. */

export const LEVELS = [
  { value: 0, label: 'Any level' },
  { value: 1, label: 'Easy' },
  { value: 2, label: 'Medium' },
  { value: 3, label: 'Hard' },
  { value: 4, label: 'Expert' },
] as const

export const WORDS_MIN = 8
export const WORDS_MAX = 200
export const WORDS_DEFAULT = 12

export type GenerateBrief = {
  topic: string
  difficulty: number
  words: number
}

export function levelLabel(value: number) {
  return LEVELS.find((level) => level.value === value)?.label ?? 'Any level'
}
