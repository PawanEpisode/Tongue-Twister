function tries(count: number): string {
  return `${count} ${count === 1 ? 'try' : 'tries'}`
}

/** Best score and how many times this twister has been tried. */
export function TwisterScore({
  bestScore,
  attempts,
}: {
  bestScore: number | null
  attempts: number
}) {
  if (attempts <= 0) {
    return <p className="text-sm text-muted-foreground">Not tried yet</p>
  }
  if (bestScore == null) {
    return (
      <p className="text-sm text-muted-foreground">
        No score yet · {tries(attempts)}
      </p>
    )
  }
  const width = Math.min(100, Math.max(0, bestScore))
  return (
    <div className="flex items-center gap-3 text-sm text-muted-foreground">
      <div
        className="h-1.5 w-16 overflow-hidden rounded-full bg-foreground/10"
        role="img"
        aria-label={`Best score ${bestScore} out of 100`}
      >
        <div
          className="h-full rounded-full bg-pink"
          style={{ width: `${width}%` }}
        />
      </div>
      <p>
        Best <span className="font-semibold text-foreground">{bestScore}</span>
        {' · '}
        {tries(attempts)}
      </p>
    </div>
  )
}
