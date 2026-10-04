import { useQuery } from '@tanstack/react-query'
import { useEffect } from 'react'
import { api } from '#/lib/api'
import { track } from '#/lib/observability/analytics'
import Compat from './Compat'
import Faq from './Faq'
import FinalCta from './FinalCta'
import Hero from './Hero'
import HowItWorks from './HowItWorks'
import MobileCta from './MobileCta'
import Modes from './Modes'
import Personas from './Personas'
import PrivacyBand from './PrivacyBand'
import ProductTabs from './ProductTabs'
import ProofStrip from './ProofStrip'
import PromiseBand from './PromiseBand'
import TwisterCarousel from './TwisterCarousel'
import { useSectionView } from './useSectionView'

/** The signed-out home page: one idea per screen, scroll-driven, ending in sign-up. */
export default function PublicLanding() {
  const { data } = useQuery({
    queryKey: ['landing'],
    queryFn: api.landing,
    staleTime: 5 * 60_000,
  })
  useEffect(() => track('landing_viewed', { audience: 'guest' }), [])
  const how = useSectionView<HTMLDivElement>('how')
  const modes = useSectionView<HTMLDivElement>('features')
  const privacy = useSectionView<HTMLDivElement>('proof')
  const faq = useSectionView<HTMLDivElement>('faq')
  return (
    <div className="space-y-0">
      <Hero />
      <ProductTabs />
      <ProofStrip data={data} />
      <PromiseBand />
      <div ref={how}>
        <HowItWorks />
      </div>
      <div ref={modes}>
        <Modes />
      </div>
      <Personas />
      <TwisterCarousel data={data} />
      <div ref={privacy}>
        <PrivacyBand />
      </div>
      <Compat />
      <div ref={faq}>
        <Faq />
      </div>
      <FinalCta />
      <MobileCta />
    </div>
  )
}
