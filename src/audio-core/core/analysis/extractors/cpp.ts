import { applyWindow, hann } from '../../dsp/window'
import { Cepstrum, cepstralPeakProminence } from '../../dsp/cepstrum'
import { defineExtractor } from '../extractor'
import { f0 } from './f0'

export interface CppOptions {
  readonly minFrequency: number
  readonly maxFrequency: number
}

export interface CppResult {
  cpp: number
  quefrency: number
}

/**
 * Cepstral peak prominence (Hillenbrand 1994). Columns: `cpp` (dB).
 * Unvoiced frames write NaN. Higher = more harmonic / less breathy.
 */
export const cpp = defineExtractor<CppResult, CppOptions>({
  id: 'cpp',
  deps: [f0],
  columns: ['cpp'],
  create(context, options) {
    const minHz = options?.minFrequency ?? 60
    const maxHz = options?.maxFrequency ?? 800
    const { frameSize, sampleRate } = context
    const window = hann(frameSize)
    const windowed = new Float64Array(frameSize)
    const cepstrum = new Cepstrum(frameSize)
    const minQ = sampleRate / maxHz
    const maxQ = sampleRate / minHz
    const result: CppResult = { cpp: NaN, quefrency: NaN }
    return {
      process(frame, deps, out) {
        result.cpp = NaN
        result.quefrency = NaN
        if (deps.get(f0).voiced) {
          applyWindow(frame.samples, window, windowed)
          cepstrum.compute(windowed)
          const measured = cepstralPeakProminence(cepstrum.values, minQ, maxQ)
          result.cpp = measured.cpp
          result.quefrency = measured.quefrency / sampleRate
        }
        out.set('cpp', result.cpp)
        return result
      },
    }
  },
})
