/**
 * YIN fundamental frequency estimator (de Cheveigné & Kawahara, 2002).
 *
 * Steps: difference function d(τ), cumulative mean normalised difference d'(τ), absolute threshold
 * with descent to the local minimum, parabolic refinement.
 *
 * d(τ) is computed exactly via FFT cross-correlation in O(N log N):
 *   d(τ) = E(0) + E(τ) − 2·r(τ), r(τ) = Σ_{j<W} x[j]·x[j+τ], E(τ) = Σ_{j<W} x[j+τ]²
 * With W = N/2 no lag up to W wraps around, so a size-N transform needs no zero padding.
 *
 * Textbook YIN integrates over the head of the frame, so its measurement is centred ~(W+τ)/2 into
 * the window rather than at N/2, which reads as a pitch error whenever f0 is moving (vibrato,
 * slides). We therefore average the difference function of the frame with that of the reversed
 * frame: the two integration regions mirror each other, the combined centre of gravity is exactly
 * the window centre for every lag, and every sample of the frame contributes.
 *
 * `detect` is allocation-free; the returned object is reused between calls.
 */

import { Fft } from './fft'
import { parabolicOffset, parabolicValue } from './interpolate'

export interface YinOptions {
  /** Frame length in samples; power of two. Lags up to frameSize / 2 are searched. */
  readonly frameSize: number
  readonly sampleRate: number
  /** Lowest f0 to consider, Hz. Default 50. Limited by frameSize / 2 lags. */
  readonly minFrequency?: number
  /** Highest f0 to consider, Hz. Default 1500. */
  readonly maxFrequency?: number
  /** Absolute threshold on d'(τ); the first dip below it wins. Default 0.15. */
  readonly threshold?: number
}

export interface YinResult {
  /** Estimated f0 in Hz, or NaN when the frame has no usable periodicity (e.g. silence). */
  frequency: number
  /** 1 − d'(τ*) clamped to [0, 1]: ≈1 for clean periodic input, low for noise. */
  confidence: number
  /** Refined period in samples (NaN with `frequency`). */
  period: number
  /** Whether a dip below the threshold was found (false = fell back to the global minimum). */
  belowThreshold: boolean
}

const ENERGY_EPSILON = 1e-12

export class Yin {
  readonly frameSize: number
  readonly sampleRate: number
  readonly threshold: number
  readonly minLag: number
  readonly maxLag: number
  /** d'(τ) for τ = 0..frameSize/2 after the last `detect` (exposed for tests and tuning). */
  readonly cmndf: Float64Array

  private readonly fft: Fft
  private readonly re: Float64Array
  private readonly im: Float64Array
  private readonly headRe: Float64Array
  private readonly headIm: Float64Array
  private readonly reversed: Float64Array
  private readonly forwardCorrelation: Float64Array
  private readonly energy: Float64Array
  private readonly result: YinResult = {
    frequency: NaN,
    confidence: 0,
    period: NaN,
    belowThreshold: false,
  }

  constructor(options: YinOptions) {
    const { frameSize, sampleRate } = options
    const minFrequency = options.minFrequency ?? 50
    const maxFrequency = options.maxFrequency ?? 1500
    const half = frameSize >> 1

    this.fft = new Fft(frameSize)
    this.frameSize = frameSize
    this.sampleRate = sampleRate
    this.threshold = options.threshold ?? 0.15
    this.minLag = Math.max(2, Math.ceil(sampleRate / maxFrequency))
    this.maxLag = Math.min(half - 1, Math.floor(sampleRate / minFrequency))
    if (this.minLag >= this.maxLag) {
      throw new RangeError(
        `Frequency range ${minFrequency}–${maxFrequency} Hz is not resolvable with ` +
          `frameSize ${frameSize} at ${sampleRate} Hz`,
      )
    }

    this.re = new Float64Array(frameSize)
    this.im = new Float64Array(frameSize)
    this.headRe = new Float64Array(frameSize)
    this.headIm = new Float64Array(frameSize)
    this.reversed = new Float64Array(frameSize)
    this.forwardCorrelation = new Float64Array(half + 1)
    this.energy = new Float64Array(frameSize + 1)
    this.cmndf = new Float64Array(half + 1)
  }

  /** Lowest frequency the configured lag range can report. */
  get minFrequency(): number {
    return this.sampleRate / this.maxLag
  }

  /** Highest frequency the configured lag range can report. */
  get maxFrequency(): number {
    return this.sampleRate / this.minLag
  }

  detect(frame: ArrayLike<number>): Readonly<YinResult> {
    const n = this.frameSize
    const half = n >> 1
    const { re, reversed, forwardCorrelation, energy, cmndf, result } = this
    if (frame.length < n) throw new RangeError(`Frame must hold ${n} samples, got ${frame.length}`)

    // Cumulative energy: energy[k] = Σ_{i<k} x[i]².
    energy[0] = 0
    for (let i = 0; i < n; i++) {
      const x = frame[i]
      energy[i + 1] = energy[i] + x * x
      re[i] = x
      reversed[n - 1 - i] = x
    }
    if (energy[n] < ENERGY_EPSILON) {
      return this.unvoiced()
    }

    // r_fwd(τ) = Σ_{j<W} x[j]·x[j+τ]  (head of the frame), then the same on the reversed frame,
    // which equals Σ over the tail of the frame.
    this.correlateWithHead(re)
    forwardCorrelation.set(re.subarray(0, half + 1))
    this.correlateWithHead(reversed)

    // Difference function averaged over both directions, then cumulative mean normalisation.
    const headEnergy = energy[half]
    const tailEnergy = energy[n] - energy[n - half]
    cmndf[0] = 1
    let running = 0
    for (let tau = 1; tau <= half; tau++) {
      const forward = headEnergy + (energy[tau + half] - energy[tau]) - 2 * forwardCorrelation[tau]
      const backward = tailEnergy + (energy[n - tau] - energy[n - half - tau]) - 2 * reversed[tau]
      let d = 0.5 * (forward + backward)
      if (d < 0) d = 0
      running += d
      cmndf[tau] = running > 0 ? (d * tau) / running : 1
    }

    // Absolute threshold: first dip under it, followed to its local minimum.
    const { minLag, maxLag, threshold } = this
    let tau = -1
    for (let lag = minLag; lag <= maxLag; lag++) {
      if (cmndf[lag] < threshold) {
        while (lag + 1 <= maxLag && cmndf[lag + 1] < cmndf[lag]) lag++
        tau = lag
        break
      }
    }
    const belowThreshold = tau >= 0
    if (!belowThreshold) {
      let best = Infinity
      for (let lag = minLag; lag <= maxLag; lag++) {
        if (cmndf[lag] < best) {
          best = cmndf[lag]
          tau = lag
        }
      }
    }

    const a = cmndf[tau - 1]
    const b = cmndf[tau]
    const c = cmndf[tau + 1]
    const offset = parabolicOffset(a, b, c)
    const dip = Math.max(0, parabolicValue(a, b, c, offset))
    const period = tau + offset

    result.frequency = this.sampleRate / period
    result.period = period
    result.confidence = Math.min(1, Math.max(0, 1 - dip))
    result.belowThreshold = belowThreshold
    return result
  }

  /**
   * Cross-correlates `signal` (length N, in place: becomes the correlation) with its own first half:
   * on return `signal[τ] = Σ_{j<N/2} signal[j]·signal[j+τ]` for τ ≤ N/2.
   */
  private correlateWithHead(signal: Float64Array): void {
    const n = this.frameSize
    const half = n >> 1
    const { im, headRe, headIm } = this
    for (let i = 0; i < half; i++) headRe[i] = signal[i]
    headRe.fill(0, half)
    headIm.fill(0)
    im.fill(0)
    this.fft.forward(headRe, headIm)
    this.fft.forward(signal, im)
    // R = X · conj(H)
    for (let k = 0; k < n; k++) {
      const xr = signal[k]
      const xi = im[k]
      const hr = headRe[k]
      const hi = headIm[k]
      signal[k] = xr * hr + xi * hi
      im[k] = xi * hr - xr * hi
    }
    this.fft.inverse(signal, im)
  }

  private unvoiced(): Readonly<YinResult> {
    const { result } = this
    result.frequency = NaN
    result.period = NaN
    result.confidence = 0
    result.belowThreshold = false
    this.cmndf.fill(1)
    return result
  }
}
