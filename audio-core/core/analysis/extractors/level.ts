import { amplitudeToDb, peak, rms } from '../../dsp/level'
import { defineExtractor } from '../extractor'

export interface LevelOptions {
  /** Value reported for digital silence instead of −∞ dBFS. Default −120. */
  readonly floorDb: number
}

export interface LevelResult {
  /** RMS of the frame, linear. */
  rms: number
  /** RMS in dBFS (0 = full-scale sine would be −3.01). */
  dbfs: number
  /** Peak absolute sample of the frame, linear. */
  peak: number
}

/** Frame level. Columns: `rms` (linear), `dbfs`, `peak` (linear). */
export const level = defineExtractor<LevelResult, LevelOptions>({
  id: 'level',
  deps: [],
  columns: ['rms', 'dbfs', 'peak'],
  create(_context, options) {
    const floorDb = options?.floorDb ?? -120
    const result: LevelResult = { rms: 0, dbfs: floorDb, peak: 0 }
    return {
      process(frame, _deps, out) {
        result.rms = rms(frame.samples)
        result.dbfs = amplitudeToDb(result.rms, floorDb)
        result.peak = peak(frame.samples)
        out.set('rms', result.rms)
        out.set('dbfs', result.dbfs)
        out.set('peak', result.peak)
        return result
      },
    }
  },
})
