import { WORD_LOOK } from './wordLook'
import type { TargetStatus } from './wordLook'
import { cn } from '#/lib/utils'

/** The same passage look without interaction, for the public score card (no heard words to coach on). */
export default function StaticPassage({
  words,
}: {
  words: readonly { text: string; status: TargetStatus }[]
}) {
  if (!words.length) return null
  return (
    <ul
      aria-label="Word by word"
      className="font-display text-lg leading-[2.1rem]"
    >
      {words.map((w, i) => {
        const look = WORD_LOOK[w.status]
        return (
          <li
            key={`${i}-${w.text}`}
            className={cn('mr-1.5 inline-block rounded-md px-1', look.word)}
          >
            {w.text}
            <span className="sr-only"> ({look.label})</span>
          </li>
        )
      })}
    </ul>
  )
}
