import { defineExtractor } from '../extractor'
import { spectrum } from './spectrum'

export interface OnsetOptions {
  /** Half-width of the frequency max-filter, bins. Default 3 (Böck Superflux). */
  readonly maxFilterBins: number
}

export interface OnsetResult {
  /** Half-wave rectified spectral flux after a frequency max-filter. */
  strength: number
}

/**
 * Superflux onset strength (Böck, Krebs & Widmer 2012): log-magnitude, max-filter across
 * nearby bins (suppresses vibrato), then positive spectral difference.
 * Column: `onsetStrength`.
 */
export const onset = defineExtractor<OnsetResult, OnsetOptions>({
  id: 'onset',
  deps: [spectrum],
  columns: ['onsetStrength'],
  create(_context, options) {
    const width = options?.maxFilterBins ?? 3
    let prev: Float32Array | undefined
    let buffer: Float32Array | undefined
    const result: OnsetResult = { strength: 0 }
    return {
      reset() {
        prev = undefined
      },
      process(_frame, deps, out) {
        const { magnitude } = deps.get(spectrum)
        if (buffer === undefined || buffer.length !== magnitude.length) {
          buffer = new Float32Array(magnitude.length)
        }
        maxFilter(magnitude, width, buffer)
        let flux = 0
        if (prev !== undefined && prev.length === buffer.length) {
          for (let k = 0; k < buffer.length; k++) {
            const delta = buffer[k] - prev[k]
            if (delta > 0) flux += delta
          }
        } else {
          prev = new Float32Array(buffer.length)
        }
        prev.set(buffer)
        result.strength = flux
        out.set('onsetStrength', flux)
        return result
      },
    }
  },
})

function maxFilter(input: Float32Array, width: number, out: Float32Array): void {
  const n = input.length
  for (let k = 0; k < n; k++) {
    let max = -Infinity
    const lo = k - width
    const hi = k + width
    for (let j = lo < 0 ? 0 : lo; j <= hi && j < n; j++) {
      const value = Math.log(input[j] + 1e-12)
      if (value > max) max = value
    }
    out[k] = max
  }
}
