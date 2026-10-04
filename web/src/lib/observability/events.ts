/**
 * The one analytics allow-list (spec 16 D28). Every event the app may send is declared here with the exact
 * properties it may carry; `sanitise` drops everything else, so a stray field (a transcript, an email, a
 * twister's text) can never leave the browser even if a call site is wrong. Properties are closed enums or
 * small numbers only: never free text, ids, or anything that identifies a person.
 */
type Rule = readonly string[] | 'int1to5'

const SECTIONS = [
  'hero',
  'demo',
  'problem',
  'how',
  'features',
  'levels',
  'families',
  'progress',
  'proof',
  'faq',
  'final',
  'footer',
  'header',
  'sticky',
] as const
const DEMO_TWISTERS = [
  'she-sells-seashells',
  'fat-frogs',
  'sam-sam-sheep',
] as const
const INTENTS = [
  'practise',
  'save_demo',
  'favourite',
  'generate',
  'record',
  'locked_filter',
  'locked_nav',
  'hero_cta',
  'header_cta',
  'footer_cta',
  'direct',
] as const

export const EVENT_RULES = {
  practice_started: { mode: ['read_along', 'speak_score', 'record'] },
  attempt_completed: {
    kind: ['test', 'train', 'drill', 'record'],
    score_band: ['0-49', '50-79', '80-100'],
  },
  score_card_shared: {},
  twister_generated: { difficulty: 'int1to5' },
  // Public site (PRD section 16): closed enums only, never free text.
  landing_viewed: { audience: ['guest'] },
  landing_section_viewed: { section: SECTIONS },
  landing_cta_clicked: { where: SECTIONS },
  demo_started: { twister: DEMO_TWISTERS },
  demo_completed: {
    score_band: ['0-49', '50-79', '80-100'],
    mode: ['voice', 'example'],
  },
  demo_unsupported: {},
  gate_shown: { intent: INTENTS },
  gate_dismissed: { intent: INTENTS },
  gate_continue: { intent: INTENTS, method: ['password', 'google', 'code'] },
  demo_claimed: { score_band: ['0-49', '50-79', '80-100'] },
} as const satisfies Record<string, Record<string, Rule>>

export type EventProps = {
  practice_started: { mode: 'read_along' | 'speak_score' | 'record' }
  attempt_completed: {
    kind: 'test' | 'train' | 'drill' | 'record'
    score_band?: '0-49' | '50-79' | '80-100'
  }
  score_card_shared: Record<never, never>
  twister_generated: { difficulty?: number }
  landing_viewed: { audience: 'guest' }
  landing_section_viewed: { section: LandingSection }
  landing_cta_clicked: { where: LandingSection }
  demo_started: { twister: (typeof DEMO_TWISTERS)[number] }
  demo_completed: {
    score_band: '0-49' | '50-79' | '80-100'
    mode: 'voice' | 'example'
  }
  demo_unsupported: Record<never, never>
  gate_shown: { intent: GateIntentName }
  gate_dismissed: { intent: GateIntentName }
  gate_continue: {
    intent: GateIntentName
    method: 'password' | 'google' | 'code'
  }
  demo_claimed: { score_band: '0-49' | '50-79' | '80-100' }
}
export type LandingSection = (typeof SECTIONS)[number]
export type GateIntentName = (typeof INTENTS)[number]
export type EventName = keyof EventProps

/** The band a 0-100 score falls in; coarse on purpose. */
export const scoreBand = (score: number): '0-49' | '50-79' | '80-100' =>
  score >= 80 ? '80-100' : score >= 50 ? '50-79' : '0-49'

export const isEventName = (name: string): name is EventName =>
  Object.hasOwn(EVENT_RULES, name)

/** Keeps only the declared properties with allowed values; returns null for an undeclared event. */
export function sanitise(
  name: string,
  props: Record<string, unknown> = {},
): Record<string, string | number> | null {
  if (!isEventName(name)) return null
  const rules = EVENT_RULES[name] as Record<string, Rule>
  const out: Record<string, string | number> = {}
  for (const [key, rule] of Object.entries(rules)) {
    const value = props[key]
    if (rule === 'int1to5') {
      if (
        typeof value === 'number' &&
        Number.isInteger(value) &&
        value >= 1 &&
        value <= 5
      )
        out[key] = value
    } else if (typeof value === 'string' && rule.includes(value)) {
      out[key] = value
    }
  }
  return out
}
