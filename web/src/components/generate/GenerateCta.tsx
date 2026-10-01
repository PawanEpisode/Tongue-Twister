import { Loader2, Sparkles } from 'lucide-react'
import { Button } from '#/components/ui/button'

const PHASE = {
  make: { label: 'Make my twister', pending: false, again: false },
  writing: { label: 'Making your twister…', pending: true, again: false },
  again: { label: 'Make another', pending: false, again: true },
} as const

export type GeneratePhase = keyof typeof PHASE

/** The one submit control. Its label and style follow compose, in-flight, and done. */
export function GenerateCta({
  phase,
  disabled = false,
  type = 'submit',
  onClick,
}: {
  phase: GeneratePhase
  disabled?: boolean
  type?: 'submit' | 'button'
  onClick?: () => void
}) {
  const { label, pending, again } = PHASE[phase]
  const Icon = pending ? Loader2 : Sparkles
  return (
    <Button
      type={type}
      onClick={onClick}
      variant={again ? 'outline' : 'default'}
      disabled={disabled || pending}
      aria-disabled={disabled || pending}
      className="w-full sm:w-auto gap-2"
    >
      <Icon
        className={pending ? 'size-4 animate-spin' : 'size-4'}
        aria-hidden
      />
      {label}
    </Button>
  )
}
