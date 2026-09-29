import { useEffect, useState } from 'react'
import type { ComponentType } from 'react'

type Props = { animationData: object; loop?: boolean; className?: string }

/** lottie-web touches `document` on import, so load it client-side only (SSR-safe). */
export default function ClientLottie({
  animationData,
  loop = true,
  className,
}: Props) {
  const [Cmp, setCmp] = useState<ComponentType<{
    src: object
    loop?: boolean
    autoplay?: boolean
    className?: string
  }> | null>(null)
  useEffect(() => {
    let live = true
    import('lottie-react').then((m) => {
      if (live) setCmp(() => m.Lottie as never)
    })
    return () => {
      live = false
    }
  }, [])
  return Cmp ? (
    <Cmp src={animationData} loop={loop} autoplay className={className} />
  ) : null
}
