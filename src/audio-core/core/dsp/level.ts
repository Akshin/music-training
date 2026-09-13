/** Signal level: RMS and decibel conversions. */

/** Root mean square of `samples[start, end)`. */
export function rms(samples: ArrayLike<number>, start = 0, end = samples.length): number {
  const count = end - start
  if (count <= 0) return 0
  let sum = 0
  for (let i = start; i < end; i++) sum += samples[i] * samples[i]
  return Math.sqrt(sum / count)
}

/** Peak absolute value of `samples[start, end)`. */
export function peak(samples: ArrayLike<number>, start = 0, end = samples.length): number {
  let max = 0
  for (let i = start; i < end; i++) {
    const magnitude = Math.abs(samples[i])
    if (magnitude > max) max = magnitude
  }
  return max
}

/**
 * Amplitude → decibels relative to full scale (1.0 → 0 dBFS).
 * Digital silence would be −∞; it is clamped to `floorDb` so averages and charts stay finite.
 */
export function amplitudeToDb(amplitude: number, floorDb = -120): number {
  if (Number.isNaN(amplitude)) return NaN
  if (amplitude <= 0) return floorDb
  return Math.max(floorDb, 20 * Math.log10(amplitude))
}

export function dbToAmplitude(db: number): number {
  return 10 ** (db / 20)
}
