/**
 * Helpers for comparing a measured f0 contour against a known one in tests.
 */

export interface ContourSample {
  /** Time the measurement claims to describe, seconds. */
  readonly time: number
  readonly frequency: number
}

export interface ContourFit {
  /** Time shift (seconds) of the expected contour that best explains the measurement. */
  readonly shiftSeconds: number
  /** RMS error in cents at that shift. */
  readonly rmsCents: number
  /** RMS error in cents at zero shift. */
  readonly rmsCentsUnshifted: number
}

/**
 * Finds the time shift δ in `[-maxShift, maxShift]` (step `step`) that minimises the RMS cents
 * error between `measured[i].frequency` and `expected(measured[i].time + δ)`.
 * A measurement centred on its window has |δ| ≈ 0 regardless of any amplitude smoothing.
 */
export function fitTimeShift(
  measured: readonly ContourSample[],
  expected: (time: number) => number,
  maxShift = 0.01,
  step = 0.00025,
): ContourFit {
  const rmsAt = (shift: number): number => {
    let sum = 0
    let count = 0
    for (const sample of measured) {
      if (Number.isNaN(sample.frequency)) continue
      const error = 1200 * Math.log2(sample.frequency / expected(sample.time + shift))
      sum += error * error
      count++
    }
    return count === 0 ? NaN : Math.sqrt(sum / count)
  }
  let best = 0
  let bestRms = Infinity
  for (let shift = -maxShift; shift <= maxShift + 1e-12; shift += step) {
    const rms = rmsAt(shift)
    if (rms < bestRms) {
      bestRms = rms
      best = shift
    }
  }
  return { shiftSeconds: best, rmsCents: bestRms, rmsCentsUnshifted: rmsAt(0) }
}

/** Largest |cents| deviation of the contour from `centreHz`. */
export function peakExcursionCents(measured: readonly ContourSample[], centreHz: number): number {
  let peak = 0
  for (const sample of measured) {
    if (Number.isNaN(sample.frequency)) continue
    peak = Math.max(peak, Math.abs(1200 * Math.log2(sample.frequency / centreHz)))
  }
  return peak
}
