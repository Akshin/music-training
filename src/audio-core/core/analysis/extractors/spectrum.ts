import { RealFft } from '../../dsp/fft'
import { applyWindow, makeWindow, windowSum, type WindowType } from '../../dsp/window'
import { defineExtractor } from '../extractor'

export interface SpectrumOptions {
  /** Analysis window. Default 'hann'. */
  readonly window: WindowType
}

export interface SpectrumResult {
  /**
   * Linear magnitude per bin, `bins = frameSize / 2 + 1` values. Scaled so a full-scale sine
   * centred on a bin reads ≈ 1.0 there; `amplitudeToDb` turns it into dBFS.
   * Reused between frames — copy to keep.
   */
  readonly magnitude: Float32Array
  readonly bins: number
  /** Frequency spacing between bins, Hz. */
  readonly binHz: number
}

/**
 * Magnitude spectrum of the windowed frame. Shared intermediate for spectral features and the
 * live spectrum display; writes no timeline columns.
 */
export const spectrum = defineExtractor<SpectrumResult, SpectrumOptions>({
  id: 'spectrum',
  deps: [],
  columns: [],
  create({ sampleRate, frameSize }, options) {
    const window = makeWindow(options?.window ?? 'hann', frameSize)
    const windowed = new Float64Array(frameSize)
    const fft = new RealFft(frameSize)
    const gain = windowSum(window)
    const result: SpectrumResult = {
      magnitude: new Float32Array(fft.bins),
      bins: fft.bins,
      binHz: sampleRate / frameSize,
    }
    const lastBin = fft.bins - 1
    return {
      process(frame) {
        applyWindow(frame.samples, window, windowed)
        fft.forward(windowed)
        // Interior bins carry half the energy of a real sine (the other half is in the mirror bin).
        fft.magnitude(result.magnitude, 2 / gain)
        result.magnitude[0] /= 2
        result.magnitude[lastBin] /= 2
        return result
      },
    }
  },
})
