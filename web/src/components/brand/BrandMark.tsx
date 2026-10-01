import { Link } from '@tanstack/react-router'
import { useId } from 'react'
import { cn } from '#/lib/utils'

/** Crossbar of the T. Mirrored in `public/favicon.svg` (scaled ×16). */
const CAP = 'M6.8 11.35C10.5 9.15 21.5 9.15 25.2 11.35'
/** Stem that hooks into a twist. Mirrored in `public/favicon.svg` (scaled ×16). */
const STEM =
  'M16 11.55V19.15C16 24.15 22.55 24.75 23.7 21.05C24.7 17.9 21.55 16.35 19.7 18.25'

/**
 * The Twister mark: a gradient squircle and a T whose stem curls into a twist.
 * Theme tokens paint the tile so light, dark, and reading all stay on-brand.
 */
export function BrandMark({ className }: { className?: string }) {
  const id = `twister-mark-${useId().replace(/:/g, '')}`
  return (
    <svg
      viewBox="0 0 32 32"
      aria-hidden
      className={cn('size-9 shrink-0 drop-shadow-md', className)}
    >
      <defs>
        <linearGradient
          id={id}
          x1="2"
          y1="1"
          x2="30"
          y2="31"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0" stopColor="var(--brand)" />
          <stop offset="0.58" stopColor="var(--pink)" />
          <stop offset="1" stopColor="var(--cyan)" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="9" fill={`url(#${id})`} />
      <g transform="translate(16 15.4) scale(0.9) translate(-16 -16)">
        <path
          d={CAP}
          fill="none"
          stroke="#fff"
          strokeWidth="2.85"
          strokeLinecap="round"
        />
        <path
          d={STEM}
          fill="none"
          stroke="#fff"
          strokeWidth="2.45"
          strokeLinecap="round"
        />
      </g>
    </svg>
  )
}

/** Mark plus wordmark. The tile carries the color; the name stays solid in every theme. */
export function BrandLink() {
  return (
    <Link
      to="/"
      className="group inline-flex items-center gap-2.5 rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
    >
      <BrandMark className="transition-transform duration-300 ease-out group-hover:[transform:scale(1.05)_rotate(-6deg)]" />
      <span className="font-display text-[1.35rem] leading-none font-extrabold tracking-[-0.04em] text-foreground">
        Twister
      </span>
    </Link>
  )
}
