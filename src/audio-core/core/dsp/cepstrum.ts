/**
 * Real cepstrum of a windowed frame: IFFT of log-power.
 *
 * Quefrency 0 is the spectral tilt; the first rahmonic sits at 1/f0 samples. Cepstral peak
 * prominence (Hillenbrand 1994) is how far that peak stands above a linear fit of the cepstrum
 * in the expected f0 quefrency band — high for a harmonic voice, low for noise or breath.
 */

import { Fft } from './fft'
import { parabolicOffset, parabolicValue } from './interpolate'

export interface CppResult {
  /** Peak minus the linear trend, dB. NaN when no rahmonic is found. */
  cpp: number
  /** Quefrency of the peak, seconds. */
  quefrency: number
}

export class Cepstrum {
  readonly size: number
  readonly values: Float64Array
  private readonly fft: Fft
  private readonly re: Float64Array
  private readonly im: Float64Array

  constructor(size: number) {
    this.size = size
    this.fft = new Fft(size)
    this.re = new Float64Array(size)
    this.im = new Float64Array(size)
    this.values = new Float64Array(size >> 1)
  }

  /** `input` is the already-windowed frame. */
  compute(input: ArrayLike<number>): Float64Array {
    const n = this.size
    const { re, im, fft, values } = this
    const count = Math.min(input.length, n)
    for (let i = 0; i < count; i++) re[i] = input[i]
    re.fill(0, count)
    im.fill(0)
    fft.forward(re, im)
    const bins = (n >> 1) + 1
    for (let k = 0; k < bins; k++) {
      const power = re[k] * re[k] + im[k] * im[k]
      re[k] = 10 * Math.log10(power + 1e-20)
      im[k] = 0
    }
    for (let k = 1; k < bins - 1; k++) {
      re[n - k] = re[k]
      im[n - k] = 0
    }
    fft.inverse(re, im)
    const half = n >> 1
    for (let q = 0; q < half; q++) values[q] = re[q]
    return values
  }
}

export function cepstralPeakProminence(
  cepstrum: Float64Array,
  minQuefrency: number,
  maxQuefrency: number,
): CppResult {
  const lo = Math.max(2, Math.floor(minQuefrency))
  const hi = Math.min(cepstrum.length - 2, Math.ceil(maxQuefrency))
  if (hi - lo < 4) return { cpp: NaN, quefrency: NaN }

  let sumQ = 0
  let sumC = 0
  let sumQQ = 0
  let sumQC = 0
  const n = hi - lo + 1
  for (let q = lo; q <= hi; q++) {
    const c = cepstrum[q]
    sumQ += q
    sumC += c
    sumQQ += q * q
    sumQC += q * c
  }
  const denom = n * sumQQ - sumQ * sumQ
  const slope = denom === 0 ? 0 : (n * sumQC - sumQ * sumC) / denom
  const intercept = (sumC - slope * sumQ) / n

  let peakQ = lo
  let peak = -Infinity
  for (let q = lo; q <= hi; q++) {
    if (cepstrum[q] > peak) {
      peak = cepstrum[q]
      peakQ = q
    }
  }
  const offset = parabolicOffset(cepstrum[peakQ - 1], cepstrum[peakQ], cepstrum[peakQ + 1])
  const refined = parabolicValue(cepstrum[peakQ - 1], cepstrum[peakQ], cepstrum[peakQ + 1], offset)
  const qPeak = peakQ + offset
  const trend = intercept + slope * qPeak
  return { cpp: 10 * (refined - trend), quefrency: qPeak }
}
