/**
 * Decorative product preview for the auth screens, drawn from the app's own UI
 * (score ring, word-by-word review, streak). Sample values only — no real users.
 */
const WORDS: [string, 'ok' | 'slip'][] = [
  ['She', 'ok'],
  ['sells', 'ok'],
  ['sea', 'ok'],
  ['shells', 'slip'],
  ['by', 'ok'],
  ['the', 'ok'],
  ['sea', 'ok'],
  ['shore', 'ok'],
]

function ScoreRing({ score }: { score: number }) {
  const r = 44
  const c = 2 * Math.PI * r
  return (
    <svg
      viewBox="0 0 110 110"
      className="size-28"
      role="img"
      aria-label={`Sample score ${score}`}
    >
      <defs>
        <linearGradient id="ring" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="var(--cyan)" />
          <stop offset="1" stopColor="var(--brand)" />
        </linearGradient>
      </defs>
      <circle
        cx="55"
        cy="55"
        r={r}
        fill="none"
        stroke="var(--muted)"
        strokeWidth="9"
      />
      <circle
        cx="55"
        cy="55"
        r={r}
        fill="none"
        stroke="url(#ring)"
        strokeWidth="9"
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - score / 100)}
        transform="rotate(-90 55 55)"
      />
      <text
        x="55"
        y="53"
        textAnchor="middle"
        className="fill-foreground text-[26px] font-extrabold"
      >
        {score}
      </text>
      <text
        x="55"
        y="70"
        textAnchor="middle"
        className="fill-muted-foreground text-[9px] font-semibold uppercase tracking-widest"
      >
        score
      </text>
    </svg>
  )
}

function Wave() {
  const bars = [8, 18, 12, 26, 34, 20, 30, 14, 24, 36, 18, 10, 22, 16, 8]
  return (
    <div className="flex h-10 items-center gap-1" aria-hidden="true">
      {bars.map((h, i) => (
        <span
          key={i}
          className="w-1 rounded-full bg-gradient-to-t from-brand to-cyan"
          style={{ height: h }}
        />
      ))}
    </div>
  )
}

export function AuthShowcase() {
  return (
    <div className="relative hidden overflow-hidden rounded-[2rem] border border-border bg-card p-10 lg:flex lg:flex-col lg:justify-between">
      <div
        className="pointer-events-none absolute -right-24 -top-24 size-80 rounded-full opacity-40 blur-3xl"
        style={{ background: 'rgb(var(--glow-brand))' }}
        aria-hidden="true"
      />
      <div
        className="pointer-events-none absolute -bottom-24 -left-16 size-72 rounded-full opacity-25 blur-3xl"
        style={{ background: 'rgb(var(--glow-pink))' }}
        aria-hidden="true"
      />
      <div className="relative">
        <p className="text-sm font-semibold uppercase tracking-widest text-brand">
          Speak. Score. Improve.
        </p>
        <h2 className="mt-3 font-display text-4xl font-extrabold leading-tight">
          Say it out loud.
          <br />
          See exactly where it slips.
        </h2>
        <p className="mt-3 max-w-md text-muted-foreground">
          Word-by-word feedback on every tongue twister, plus a streak and a
          practice plan built from your weakest sounds.
        </p>
      </div>

      <div className="relative mt-8 space-y-4" aria-hidden="true">
        <div className="rounded-3xl border border-border bg-background/70 p-5 shadow-2xl backdrop-blur">
          <div className="flex items-center gap-5">
            <ScoreRing score={86} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>Sample attempt</span>
                <span className="rounded-full bg-lime/15 px-2 py-0.5 font-semibold text-lime">
                  +12 XP
                </span>
              </div>
              <Wave />
            </div>
          </div>
          <div className="mt-4 flex flex-wrap gap-1.5 text-sm font-medium">
            {WORDS.map(([w, s], i) => (
              <span
                key={i}
                className={
                  s === 'ok'
                    ? 'rounded-lg bg-lime/15 px-2 py-1 text-lime'
                    : 'rounded-lg bg-pink/10 px-2 py-1 text-pink underline decoration-wavy underline-offset-4'
                }
              >
                {w}
              </span>
            ))}
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            “shells” came out as “sells” — try the{' '}
            <b className="text-foreground">sh</b> sound.
          </p>
        </div>

        <div className="grid grid-cols-3 gap-3 text-center">
          {[
            ['7', 'day streak'],
            ['42', 'twisters'],
            ['Lv 5', 'Tongue Titan'],
          ].map(([n, l]) => (
            <div
              key={l}
              className="rounded-2xl border border-border bg-background/70 p-3 backdrop-blur"
            >
              <div className="font-display text-xl font-extrabold">{n}</div>
              <div className="text-xs text-muted-foreground">{l}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
