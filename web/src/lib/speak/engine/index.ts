/**
 * Pronunciation engine groundwork (docs/features/10, E3-2; spec 17 section A6): pure functions over a frame
 * posterior matrix. Not wired into Speak mode — nothing in the app imports this until `accurate_mode` (E3-4).
 * The Python reference is api/twisters/speak/engine; api/tests/fixtures/engine_vectors.json pins both.
 */
export { assess, scoreStatuses } from './assess'
export { DEFAULT_PROFILE } from './types'
export type {
  Assessment,
  EngineStatus,
  PhonemeResult,
  PhonemeVerdict,
  Posteriors,
  ScoringProfile,
  Unscorable,
  Word,
  WordResult,
} from './types'
export {
  UnpronounceableWords,
  dictPronouncer,
  expandVariants,
  expectedWords,
} from './variants'
export type { AccentRule, AcousticModel, Pronouncer } from './variants'
