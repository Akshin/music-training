import { lowpassBiquad } from '../../dsp/biquad'
import { applyWindow, hamming } from '../../dsp/window'
import { burg, createBurgScratch, lpcFormants } from '../../dsp/lpc'
import { defineExtractor } from '../extractor'
import { f0 } from './f0'

export interface FormantsOptions {
  /** LPC order. Default 2 + downsampled kHz (≈12 at 10 kHz). */
  readonly order: number
  /** Pre-emphasis coefficient. Default 0.97. */
  readonly preemphasis: number
  /** Analysis bandwidth after anti-aliased decimation. Default 10 kHz. */
  readonly bandwidth: number
  readonly minHz: number
  readonly maxHz: number
}

export interface FormantsResult {
  f1: number
  f2: number
  f3: number
}

/**
 * First three formants from Burg LPC on a pre-emphasised, Hamming-windowed frame.
 *
 * The frame is low-passed and decimated to ~10 kHz so order 12 covers F1–F3 without spending
 * poles on the empty 5–24 kHz band. Unvoiced frames write NaN. Columns: `f1`, `f2`, `f3`.
 */
export const formants = defineExtractor<FormantsResult, FormantsOptions>({
  id: 'formants',
  deps: [f0],
  columns: ['f1', 'f2', 'f3'],
  create(context, options) {
    const { frameSize, sampleRate } = context
    const bandwidth = options?.bandwidth ?? 10000
    const factor = Math.max(1, Math.round(sampleRate / bandwidth))
    const downRate = sampleRate / factor
    const downLength = Math.floor(frameSize / factor)
    const order = options?.order ?? Math.min(16, Math.max(8, Math.round(downRate / 1000) + 2))
    const preemphasis = options?.preemphasis ?? 0.97
    const minHz = options?.minHz ?? 250
    const maxHz = options?.maxHz ?? Math.min(5500, downRate / 2 - 200)
    const window = hamming(downLength)
    const prepared = new Float64Array(frameSize)
    const filtered = new Float64Array(frameSize)
    const down = new Float64Array(downLength)
    const lp = lowpassBiquad(0.45 * downRate, sampleRate)
    const scratch = createBurgScratch(downLength, order)
    const result: FormantsResult = { f1: NaN, f2: NaN, f3: NaN }

    return {
      process(frame, deps, out) {
        result.f1 = NaN
        result.f2 = NaN
        result.f3 = NaN
        if (deps.get(f0).voiced) {
          const samples = frame.samples
          prepared[0] = samples[0]
          for (let i = 1; i < frameSize; i++) {
            prepared[i] = samples[i] - preemphasis * samples[i - 1]
          }
          lp.reset()
          lp.process(prepared, 0, frameSize, filtered)
          for (let i = 0; i < downLength; i++) down[i] = filtered[i * factor]
          applyWindow(down, window, down)
          const error = burg(down, downLength, order, scratch)
          if (Number.isFinite(error)) {
            const poles = lpcFormants(scratch, order, downRate, { minHz, maxHz, count: 3 })
            if (poles[0] !== undefined) result.f1 = poles[0].frequency
            if (poles[1] !== undefined) result.f2 = poles[1].frequency
            if (poles[2] !== undefined) result.f3 = poles[2].frequency
          }
        }
        out.set('f1', result.f1)
        out.set('f2', result.f2)
        out.set('f3', result.f3)
        return result
      },
    }
  },
})
