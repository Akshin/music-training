import { sinc } from '../../dsp/interpolate'
import { defineExtractor } from '../extractor'
import { f0 } from './f0'

export interface VibratoOptions {
  /** History length in frames. Default 50 (500 ms at 100 fps). */
  readonly windowFrames: number
  /** Lowest vibrato rate considered, Hz. Default 4. */
  readonly minRate: number
  /** Highest vibrato rate considered, Hz. Default 12. */
  readonly maxRate: number
  /** Minimum normalised autocorrelation of a periodic contour. Default 0.35. */
  readonly minCorrelation: number
  /** Voiced fraction of the window required to report a value. Default 0.8. */
  readonly minVoiced: number
  /** Ignore shallower wobble than this, cents. Default 18. */
  readonly minExtent: number
}

export interface VibratoResult {
  /** Rate in Hz, NaN when no periodic vibrato. */
  rate: number
  /** Peak extent in cents, compensated for analysis-window attenuation. */
  extent: number
  /** Autocorrelation at the chosen lag, [0, 1], 0 when unvoiced. */
  correlation: number
}

/**
 * Vibrato rate and extent from a sliding f0 window.
 *
 * Extent is `√2 · rms(cents)` (sinusoidal peak) divided by `sinc(rate · windowSeconds)` so the
 * 43 ms analysis window's known attenuation is inverted (see ARCHITECTURE, M1 vibrato table).
 * Columns: `vibratoRate`, `vibratoExtent`.
 */
export const vibrato = defineExtractor<VibratoResult, VibratoOptions>({
  id: 'vibrato',
  deps: [f0],
  columns: ['vibratoRate', 'vibratoExtent'],
  create(context, options) {
    const windowFrames = options?.windowFrames ?? 50
    const minRate = options?.minRate ?? 4
    const maxRate = options?.maxRate ?? 12
    const minCorrelation = options?.minCorrelation ?? 0.45
    const minVoiced = options?.minVoiced ?? 0.8
    const minExtent = options?.minExtent ?? 18
    const fps = context.sampleRate / context.hopSize
    const minLag = Math.max(1, Math.round(fps / maxRate))
    const maxLag = Math.max(minLag + 2, Math.round(fps / minRate))
    const windowSeconds = context.frameSize / context.sampleRate
    const history = new Float64Array(windowFrames)
    history.fill(NaN)
    const cents = new Float64Array(windowFrames)
    let cursor = 0
    let filled = 0
    const result: VibratoResult = { rate: NaN, extent: NaN, correlation: 0 }

    return {
      reset() {
        history.fill(NaN)
        cursor = 0
        filled = 0
        result.rate = NaN
        result.extent = NaN
        result.correlation = 0
      },
      process(_frame, deps, out) {
        const { frequency } = deps.get(f0)
        history[cursor] = frequency
        cursor = (cursor + 1) % windowFrames
        if (filled < windowFrames) filled++

        result.rate = NaN
        result.extent = NaN
        result.correlation = 0
        if (filled >= windowFrames && filled > maxLag + 4) {
          const measured = readVibrato(
            history,
            cursor,
            windowFrames,
            cents,
            minLag,
            maxLag,
            minVoiced,
            minCorrelation,
            minExtent,
            fps,
            windowSeconds,
          )
          if (measured !== undefined) {
            result.rate = measured.rate
            result.extent = measured.extent
            result.correlation = measured.correlation
          }
        }
        out.set('vibratoRate', result.rate)
        out.set('vibratoExtent', result.extent)
        return result
      },
    }
  },
})

function readVibrato(
  history: Float64Array,
  cursor: number,
  n: number,
  cents: Float64Array,
  minLag: number,
  maxLag: number,
  minVoiced: number,
  minCorrelation: number,
  minExtent: number,
  fps: number,
  windowSeconds: number,
): VibratoResult | undefined {
  let voiced = 0
  for (let i = 0; i < n; i++) {
    if (history[i] > 0) voiced++
  }
  if (voiced / n < minVoiced) return undefined

  const sorted: number[] = []
  for (let i = 0; i < n; i++) {
    const hz = history[i]
    if (hz > 0) sorted.push(hz)
  }
  sorted.sort((a, b) => a - b)
  const median = sorted[sorted.length >> 1]
  if (!(median > 0)) return undefined

  let energy = 0
  for (let i = 0; i < n; i++) {
    const hz = history[(cursor + i) % n]
    const c = hz > 0 ? 1200 * Math.log2(hz / median) : 0
    cents[i] = c
    energy += c * c
  }
  if (!(energy > 0)) return undefined

  let bestLag = minLag
  let best = -Infinity
  for (let lag = minLag; lag <= maxLag && lag < n; lag++) {
    let acc = 0
    const span = n - lag
    for (let i = lag; i < n; i++) acc += cents[i] * cents[i - lag]
    const value = acc / span
    if (value > best) {
      best = value
      bestLag = lag
    }
  }
  const correlation = best / (energy / n)
  if (correlation < minCorrelation) return undefined

  const prev = lagValue(cents, n, bestLag - 1)
  const next = lagValue(cents, n, bestLag + 1)
  const offset = parabolicLag(prev, best, next)
  const lag = Math.max(minLag, Math.min(maxLag, bestLag + offset))
  const rate = fps / lag
  const rms = Math.sqrt(energy / n)
  const rawExtent = rms * Math.SQRT2
  const attenuation = sinc(rate * windowSeconds)
  const extent = attenuation > 0.2 ? rawExtent / attenuation : rawExtent
  if (extent < minExtent) return undefined
  return { rate, extent, correlation: Math.min(1, Math.max(0, correlation)) }
}

function lagValue(cents: Float64Array, count: number, lag: number): number {
  if (lag < 1 || lag >= count) return 0
  let acc = 0
  const span = count - lag
  for (let i = lag; i < count; i++) acc += cents[i] * cents[i - lag]
  return acc / span
}

function parabolicLag(prev: number, center: number, next: number): number {
  const denominator = prev - 2 * center + next
  if (denominator === 0) return 0
  const offset = (0.5 * (prev - next)) / denominator
  return offset > 0.5 ? 0.5 : offset < -0.5 ? -0.5 : offset
}
