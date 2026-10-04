export function ScoreRing({
  score,
  label = 'score',
  className = 'size-28',
}: {
  score: number
  label?: string
  className?: string
}) {
  const r = 44
  const c = 2 * Math.PI * r
  return (
    <svg
      viewBox="0 0 110 110"
      className={className}
      role="img"
      aria-label={`${label} ${score}`}
    >
      <defs>
        <linearGradient id="demo-ring" x1="0" y1="0" x2="1" y2="1">
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
        stroke="url(#demo-ring)"
        strokeWidth="9"
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - score / 100)}
        transform="rotate(-90 55 55)"
        style={{
          transition: 'stroke-dashoffset 900ms cubic-bezier(0.22, 1, 0.36, 1)',
        }}
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
        {label}
      </text>
    </svg>
  )
}
