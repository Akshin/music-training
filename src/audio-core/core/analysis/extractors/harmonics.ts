import { amplitudeToDb } from '../../dsp/level'
import { parabolicOffset, parabolicValue } from '../../dsp/interpolate'
import { defineExtractor } from '../extractor'
import { f0 } from './f0'
import { spectrum } from './spectrum'

/** Partials measured, the fundamental included. */
export const HARMONIC_COUNT = 3

export interface HarmonicsOptions {
  /** Level reported for a partial lost in silence instead of −∞ dB. Default −120. */
  readonly floorDb: number
}

export interface HarmonicsResult {
  /** Level of partials 1…3 in dBFS (a full-scale sine reads ≈ 0); NaN when unvoiced. */
  readonly levels: Float64Array
  /** Refined frequency of partials 1…3, Hz; NaN when unvoiced. */
  readonly frequencies: Float64Array
}

/**
 * Levels of the first three harmonics: for each k, the strongest spectrum bin within a third of
 * f0 of k · f0, refined by a parabola through the dB magnitudes of it and its neighbours (the Hann
 * main lobe is close to a parabola in dB, so the peak level is accurate between bins).
 * Unvoiced frames and partials above Nyquist write NaN. Columns: `h1`, `h2`, `h3` (dBFS).
 */
export const harmonics = defineExtractor<HarmonicsResult, HarmonicsOptions>({
  id: 'harmonics',
  deps: [f0, spectrum],
  columns: ['h1', 'h2', 'h3'],
  create(_context, options) {
    const floorDb = options?.floorDb ?? -120
    const columns = ['h1', 'h2', 'h3'] as const
    const result: HarmonicsResult = {
      levels: new Float64Array(HARMONIC_COUNT).fill(NaN),
      frequencies: new Float64Array(HARMONIC_COUNT).fill(NaN),
    }
    const db = (value: number | undefined) => amplitudeToDb(value ?? 0, floorDb)
    return {
      process(_frame, deps, out) {
        result.levels.fill(NaN)
        result.frequencies.fill(NaN)
        const pitch = deps.get(f0)
        if (pitch.voiced) {
          const { magnitude, bins, binHz } = deps.get(spectrum)
          // Stay closer to k · f0 than to either neighbouring partial.
          const radius = Math.max(1, Math.floor(pitch.frequency / 3 / binHz))
          for (let k = 0; k < HARMONIC_COUNT; k++) {
            const centre = Math.round(((k + 1) * pitch.frequency) / binHz)
            const from = Math.max(1, centre - radius)
            const to = Math.min(bins - 2, centre + radius)
            if (from > to) continue
            let best = from
            for (let bin = from + 1; bin <= to; bin++) {
              if ((magnitude[bin] ?? 0) > (magnitude[best] ?? 0)) best = bin
            }
            const a = db(magnitude[best - 1])
            const b = db(magnitude[best])
            const c = db(magnitude[best + 1])
            const offset = parabolicOffset(a, b, c)
            result.levels[k] = parabolicValue(a, b, c, offset)
            result.frequencies[k] = (best + offset) * binHz
          }
        }
        for (let k = 0; k < HARMONIC_COUNT; k++) out.set(columns[k]!, result.levels[k]!)
        return result
      },
    }
  },
})
