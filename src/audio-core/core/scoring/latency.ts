/**
 * Align a sung timeline to a click/reference grid.
 *
 * Each expected time (a metronome click, a note onset) is paired with the nearest detected onset
 * inside a search window. The median residual is the constant to subtract from sung times so they
 * sit on the same clock as the grid — it absorbs both I/O latency and "transport started after
 * capture". Without it, rhythm scoring in milliseconds is fiction.
 */

export interface LatencyEstimate {
  /** Seconds to subtract from sung times (positive = sung clock is late). */
  readonly seconds: number
  /** Per-expected residual (detected − expected), only for hits. */
  readonly offsets: readonly number[]
  readonly hits: number
  readonly expected: number
}

export interface LatencyOptions {
  /** How far from an expected time an onset may sit, seconds. Default 0.35. */
  readonly window?: number
}

export function estimateLatency(
  expectedTimes: readonly number[],
  detectedOnsets: readonly number[],
  options: LatencyOptions = {},
): LatencyEstimate | undefined {
  if (expectedTimes.length === 0 || detectedOnsets.length === 0) return undefined
  const window = options.window ?? 0.35
  const used = new Set<number>()
  const offsets: number[] = []
  for (const expected of expectedTimes) {
    let best = -1
    let bestAbs = window
    for (let i = 0; i < detectedOnsets.length; i++) {
      if (used.has(i)) continue
      const delta = detectedOnsets[i] - expected
      const abs = Math.abs(delta)
      if (abs <= bestAbs) {
        bestAbs = abs
        best = i
      }
    }
    if (best < 0) continue
    used.add(best)
    offsets.push(detectedOnsets[best] - expected)
  }
  if (offsets.length === 0) return undefined
  const sorted = offsets.slice().sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  const seconds = sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
  return { seconds, offsets, hits: offsets.length, expected: expectedTimes.length }
}
