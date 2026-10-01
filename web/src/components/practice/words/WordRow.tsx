import type { ReactNode } from 'react'

/** One word in a queue: the word, its respelling, a line of detail, and an optional action. */
export default function WordRow({
  word,
  respelling,
  detail,
  action,
}: {
  word: string
  respelling?: string
  detail: string
  action?: ReactNode
}) {
  return (
    <li className="glass flex items-center justify-between gap-3 rounded-2xl px-4 py-2.5">
      <div className="min-w-0">
        <div className="flex items-baseline gap-2">
          <b className="truncate text-lg">{word}</b>
          {respelling && (
            <span className="truncate text-sm text-muted-foreground">
              {respelling}
            </span>
          )}
        </div>
        <p className="text-xs text-muted-foreground">{detail}</p>
      </div>
      {action}
    </li>
  )
}
