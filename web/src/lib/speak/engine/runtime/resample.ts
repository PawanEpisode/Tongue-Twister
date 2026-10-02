/**
 * Windowed-sinc resampling to the model's 16 kHz. Microphones capture at 44.1/48 kHz; naive decimation would
 * alias high-frequency noise into the speech band, which is exactly what a phone-level scorer is sensitive to.
 */
import { SAMPLE_RATE } from './chunking'

const ZERO_CROSSINGS = 12 // per side, at the lower of the two rates

const sinc = (x: number) =>
  x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x)
// Hann-windowed kernel of half-width `half` (in input samples), cut off at `cutoff` of the input Nyquist
const kernel = (x: number, half: number, cutoff: number) =>
  Math.abs(x) >= half
    ? 0
    : cutoff * sinc(cutoff * x) * (0.5 + 0.5 * Math.cos((Math.PI * x) / half))

export function resample(
  input: Float32Array,
  fromRate: number,
  toRate = SAMPLE_RATE,
): Float32Array {
  if (!(fromRate > 0) || !(toRate > 0))
    throw new RangeError('sample rates must be positive')
  if (fromRate === toRate) return input
  const ratio = fromRate / toRate
  const outLength = Math.floor(input.length / ratio)
  const out = new Float32Array(outLength)
  // Downsampling: low-pass at the *output* Nyquist (widen the kernel); upsampling: no extra cut-off.
  const cutoff = Math.min(1, toRate / fromRate)
  const half = ZERO_CROSSINGS / cutoff
  for (let i = 0; i < outLength; i++) {
    const centre = i * ratio
    const lo = Math.max(0, Math.ceil(centre - half))
    const hi = Math.min(input.length - 1, Math.floor(centre + half))
    let acc = 0
    let norm = 0
    for (let j = lo; j <= hi; j++) {
      const w = kernel(j - centre, half, cutoff)
      acc += input[j] * w
      norm += w
    }
    out[i] = norm > 1e-9 ? acc / norm : 0
  }
  return out
}
