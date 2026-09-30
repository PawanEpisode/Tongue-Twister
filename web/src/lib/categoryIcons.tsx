import {
  AudioWaveform,
  Brain,
  Orbit,
  Sparkles,
  Speech,
  Tornado,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

/** Sound-family marks. The API still sends an emoji; the UI draws an icon from the slug. */
const CATEGORY_ICONS: Record<string, LucideIcon> = {
  hissers: AudioWaveform,
  poppers: Sparkles,
  rollers: Tornado,
  'th-tangles': Speech,
  'vowel-vortex': Orbit,
  'brain-benders': Brain,
}

export function CategoryIcon({
  slug,
  className,
}: {
  slug: string
  className?: string
}) {
  const Icon = CATEGORY_ICONS[slug] ?? AudioWaveform
  return <Icon className={className} aria-hidden />
}
