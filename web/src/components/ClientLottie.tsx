import { useEffect, useState } from 'react'
import type { ComponentType, ReactNode } from 'react'

type Props = {
  animationData: object
  loop?: boolean
  className?: string
  /** Shown if the animation library can't be loaded (offline, blocked chunk). Defaults to nothing. */
  fallback?: ReactNode
}
type LottieComponent = ComponentType<{
  src: object
  loop?: boolean
  autoplay?: boolean
  className?: string
}>

/** One shared import, so every animation on the page waits for the same chunk. */
let loading: Promise<LottieComponent> | undefined

/** A failed import is forgotten, so the next mount tries the network again. */
function loadLottie(): Promise<LottieComponent> {
  loading ??= import('lottie-react')
    .then((m) => m.Lottie as LottieComponent)
    .catch((err: unknown) => {
      loading = undefined
      throw err
    })
  return loading
}

/**
 * lottie-web touches `document` on import, so load it client-side only (SSR-safe). The animations are
 * decoration: if the chunk fails to load, render the `fallback` instead of leaving a rejected promise.
 */
export default function ClientLottie({
  animationData,
  loop = true,
  className,
  fallback = null,
}: Props) {
  const [Cmp, setCmp] = useState<LottieComponent | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let live = true
    loadLottie().then(
      (c) => live && setCmp(() => c),
      () => live && setFailed(true),
    )
    return () => {
      live = false
    }
  }, [])
  if (failed) return fallback
  return Cmp ? (
    <Cmp src={animationData} loop={loop} autoplay className={className} />
  ) : null
}
