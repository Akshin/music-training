import { Yin } from '../../dsp/yin'
import { PyinTracker } from '../../dsp/pyin'
import { defineExtractor } from '../extractor'

export interface F0Options {
  /** Lowest f0 to search, Hz. Default 50 (below the lowest bass notes; guitar low E is 82). */
  readonly minFrequency: number
  /** Highest f0 to search, Hz. Default 1500 (above soprano C6 = 1047 and guitar's top fret). */
  readonly maxFrequency: number
  /** YIN absolute threshold. Default 0.15. */
  readonly threshold: number
  /** Frames with confidence below this are reported unvoiced (`f0` = NaN). Default 0.5. */
  readonly voicingThreshold: number
  /**
   * `yin` (default) is frame-local. `pyin` runs a 5-frame Viterbi over YIN troughs (Mauch 2014);
   * the contour is ~50 ms late and more stable on noisy vowels.
   */
  readonly tracker: 'yin' | 'pyin'
  /** Viterbi lag in frames when `tracker` is `pyin`. Default 5. */
  readonly pyinDelay: number
}

export interface F0Result {
  /** f0 in Hz, NaN when unvoiced. */
  frequency: number
  /** YIN confidence in [0, 1], reported for every frame. */
  confidence: number
  voiced: boolean
}

/**
 * Fundamental frequency per frame (YIN, optionally pYIN).
 * Columns: `f0` (Hz or NaN), `f0Confidence` (0..1).
 */
export const f0 = defineExtractor<F0Result, F0Options>({
  id: 'f0',
  deps: [],
  columns: ['f0', 'f0Confidence'],
  create({ sampleRate, frameSize }, options) {
    const voicingThreshold = options?.voicingThreshold ?? 0.5
    const yin = new Yin({
      frameSize,
      sampleRate,
      minFrequency: options?.minFrequency ?? 50,
      maxFrequency: options?.maxFrequency ?? 1500,
      threshold: options?.threshold ?? 0.15,
    })
    const tracker =
      options?.tracker === 'pyin'
        ? new PyinTracker({
            minLag: yin.minLag,
            maxLag: yin.maxLag,
            sampleRate,
            delay: options?.pyinDelay,
          })
        : undefined
    const result: F0Result = { frequency: NaN, confidence: 0, voiced: false }
    return {
      reset() {
        tracker?.reset()
      },
      process(frame, _deps, out) {
        const estimate = yin.detect(frame.samples)
        if (tracker !== undefined) {
          const tracked = tracker.push(yin.cmndf)
          result.voiced = tracked.voiced && tracked.confidence >= voicingThreshold * 0.6
          result.confidence = tracked.confidence
          result.frequency = result.voiced ? tracked.frequency : NaN
        } else {
          const voiced =
            estimate.confidence >= voicingThreshold && !Number.isNaN(estimate.frequency)
          result.voiced = voiced
          result.confidence = estimate.confidence
          result.frequency = voiced ? estimate.frequency : NaN
        }
        out.set('f0', result.frequency)
        out.set('f0Confidence', result.confidence)
        return result
      },
    }
  },
})
