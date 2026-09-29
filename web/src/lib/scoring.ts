// Client-side mirror of api/twisters/scoring.py — used for live highlighting and guest mode.
export const words = (t: string) =>
  t
    .toLowerCase()
    .replace(/’/g, "'")
    .match(/[a-z0-9']+/g) ?? []

const REF_WPM: Record<number, number> = { 1: 110, 2: 130, 3: 150, 4: 170 }

/** Longest-common-subsequence based match; returns which target word indexes were hit. */
export function matchedIndexes(target: string, spoken: string): boolean[] {
  const a = words(target),
    b = words(spoken)
  const dp = Array.from({ length: a.length + 1 }, () =>
    new Array(b.length + 1).fill(0),
  )
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--)
      dp[i][j] =
        a[i] === b[j]
          ? dp[i + 1][j + 1] + 1
          : Math.max(dp[i + 1][j], dp[i][j + 1])
  const hit = new Array(a.length).fill(false)
  let i = 0,
    j = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      hit[i] = true
      i++
      j++
    } else if (dp[i + 1][j] >= dp[i][j + 1]) i++
    else j++
  }
  return hit
}

export function scoreAttempt(
  target: string,
  spoken: string,
  durationMs: number,
  difficulty: number,
) {
  const t = words(target)
  const hits = matchedIndexes(target, spoken).filter(Boolean).length
  const extra = Math.max(0, words(spoken).length - t.length)
  const accuracy = t.length
    ? Math.max(0, Math.min(1, (hits - 0.25 * extra) / t.length))
    : 0
  const wpm = words(spoken).length / (Math.max(durationMs, 500) / 60000)
  const speed =
    accuracy >= 0.6 ? Math.min(1, wpm / (REF_WPM[difficulty] ?? 130)) : 0
  const score = Math.round(accuracy * 70 + speed * 30)
  return { accuracy, wpm: Math.round(wpm * 10) / 10, score }
}
