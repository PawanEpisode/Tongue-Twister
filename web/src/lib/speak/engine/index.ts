/**
 * Pronunciation engine (docs/features/10, 13): pure functions over a frame posterior matrix. The Python
 * reference is api/twisters/speak/engine; api/tests/fixtures/engine_vectors.json and quality_vectors.json pin both.
 * The browser runtime that feeds it real audio lives in ./runtime.
 */
export { assess, scoreStatuses } from './assess'
export {
  GATE_MESSAGE,
  expectedSpeechMs,
  posteriorGate,
  signalGate,
  speechBounds,
} from './quality'
export type { Gate, Quality } from './quality'
export { DEFAULT_PROFILE, profileFromThresholds } from './types'
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
