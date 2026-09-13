/**
 * Burg LPC and formants from the resulting poles.
 *
 * Burg's method yields a stable all-pole model (reflection |k| < 1). The LPC polynomial
 * `1 + a1 z^{-1} + … + ap z^{-p}` is converted to `z^p + a1 z^{p-1} + … + ap` and solved with
 * Durand–Kerner; poles in the upper half-plane whose frequency and bandwidth look like vocal
 * formants are returned lowest-frequency first.
 */

import { durandKerner } from './roots'

export interface Formant {
  readonly frequency: number
  readonly bandwidth: number
}

export interface BurgScratch {
  readonly a: Float64Array
  readonly ef: Float64Array
  readonly eb: Float64Array
  readonly tmp: Float64Array
  readonly re: Float64Array
  readonly im: Float64Array
}

export function createBurgScratch(frameSize: number, order: number): BurgScratch {
  return {
    a: new Float64Array(order + 1),
    ef: new Float64Array(frameSize),
    eb: new Float64Array(frameSize),
    tmp: new Float64Array(order + 1),
    re: new Float64Array(order),
    im: new Float64Array(order),
  }
}

/**
 * Fills `scratch.a` with `[1, a1, …, ap]`. Returns the residual error energy, or `NaN` if the
 * frame is degenerate (silence, order too high).
 */
export function burg(
  samples: ArrayLike<number>,
  length: number,
  order: number,
  scratch: BurgScratch,
): number {
  if (length <= order + 1 || order < 1) return NaN
  const { a, ef, eb, tmp } = scratch
  a.fill(0)
  a[0] = 1
  let energy = 0
  for (let i = 0; i < length; i++) {
    const x = samples[i]
    ef[i] = x
    eb[i] = x
    energy += x * x
  }
  if (!(energy > 0)) return NaN

  for (let m = 1; m <= order; m++) {
    let num = 0
    let den = 0
    for (let i = m; i < length; i++) {
      num += ef[i] * eb[i - 1]
      den += ef[i] * ef[i] + eb[i - 1] * eb[i - 1]
    }
    if (!(den > 0)) return NaN
    const k = (-2 * num) / den
    if (!(Math.abs(k) < 1)) return NaN

    tmp[0] = 1
    for (let i = 1; i < m; i++) tmp[i] = a[i] + k * a[m - i]
    tmp[m] = k
    for (let i = 0; i <= m; i++) a[i] = tmp[i]

    for (let i = length - 1; i >= m; i--) {
      const fwd = ef[i]
      const back = eb[i - 1]
      ef[i] = fwd + k * back
      eb[i] = back + k * fwd
    }
    energy *= 1 - k * k
  }
  return energy
}

export interface FormantOptions {
  readonly minHz?: number
  readonly maxHz?: number
  readonly minBw?: number
  readonly maxBw?: number
  readonly count?: number
}

const DEFAULT_FORMANT = {
  minHz: 90,
  maxHz: 5500,
  minBw: 40,
  maxBw: 900,
  count: 3,
}

/** Poles of `scratch.a` → at most `count` formants, sorted by frequency. */
export function lpcFormants(
  scratch: BurgScratch,
  order: number,
  sampleRate: number,
  options: FormantOptions = {},
): Formant[] {
  const minHz = options.minHz ?? DEFAULT_FORMANT.minHz
  const maxHz = options.maxHz ?? DEFAULT_FORMANT.maxHz
  const minBw = options.minBw ?? DEFAULT_FORMANT.minBw
  const maxBw = options.maxBw ?? DEFAULT_FORMANT.maxBw
  const count = options.count ?? DEFAULT_FORMANT.count
  const { a, re, im } = scratch
  durandKerner(a, re, im)

  const found: Formant[] = []
  for (let i = 0; i < order; i++) {
    if (im[i] < 0) continue
    const radius = Math.hypot(re[i], im[i])
    if (radius < 0.65 || radius >= 0.999) continue
    const freq = (Math.abs(Math.atan2(im[i], re[i])) * sampleRate) / (2 * Math.PI)
    const bandwidth = (-Math.log(radius) * sampleRate) / Math.PI
    if (freq < minHz || freq > maxHz || bandwidth < minBw || bandwidth > maxBw) continue
    found.push({ frequency: freq, bandwidth })
  }
  found.sort((x, y) => x.frequency - y.frequency)
  return found.slice(0, count)
}
