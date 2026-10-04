import type { GateIntentName } from '#/lib/observability/events'

export type GateIntent = GateIntentName

/** The copy for each thing that can make the sign-in sheet open (PRD section 11). One line of why, one of what. */
export const GATE_COPY: Record<
  GateIntent,
  { title: string; body: string; cta: string }
> = {
  practise: {
    title: 'Sign in to start practising',
    body: 'Free account, no card. Your scores, streaks and progress follow you on every device.',
    cta: 'Create free account',
  },
  save_demo: {
    title: 'Save your score',
    body: 'Create a free account and this score goes straight onto your profile as your first result.',
    cta: 'Save my score',
  },
  favourite: {
    title: 'Keep your favourites',
    body: 'Sign in to star twisters and find them again from any device.',
    cta: 'Create free account',
  },
  generate: {
    title: 'Make your own twister',
    body: 'Tell us your tricky sounds and we will write a twister just for you. It is free with an account.',
    cta: 'Create free account',
  },
  record: {
    title: 'Record and replay yourself',
    body: 'Hear exactly how you sounded and watch yourself improve. Sign in to unlock recording.',
    cta: 'Create free account',
  },
  locked_filter: {
    title: 'Unlock the full library',
    body: 'Sign in to search and filter every twister by level, sound family and origin.',
    cta: 'Unlock all twisters',
  },
  locked_nav: {
    title: 'That is for members',
    body: 'Sign in to see your progress, favourites and recordings.',
    cta: 'Sign in',
  },
  hero_cta: {
    title: 'Create your free account',
    body: 'It takes under a minute. Then you can say your first twister out loud and get scored.',
    cta: 'Create free account',
  },
  header_cta: {
    title: 'Create your free account',
    body: 'It takes under a minute. Already have one? Use the same button to sign in.',
    cta: 'Create free account',
  },
  footer_cta: {
    title: 'Create your free account',
    body: 'Say it fast, say it right. Free, in your browser.',
    cta: 'Create free account',
  },
  direct: {
    title: 'Sign in to continue',
    body: 'Create a free account to practise, track progress and keep your streak.',
    cta: 'Sign in',
  },
}
