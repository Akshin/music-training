import { centsOffNearest, DEFAULT_A4, hzToMidi, nearestMidi } from '../../model/pitch'
import { defineExtractor } from '../extractor'
import { f0 } from './f0'

export interface PitchOptions {
  /** Tuning reference for A4, Hz. Default 440. */
  readonly a4: number
}

export interface PitchResult {
  /** Fractional MIDI pitch, NaN when unvoiced. */
  midi: number
  /** Nearest tempered note as integer MIDI, NaN when unvoiced. */
  note: number
  /** Deviation from that note in cents, [-50, 50], NaN when unvoiced. */
  cents: number
}

/**
 * Musical reading of f0. Columns: `midi` (fractional), `note` (integer MIDI), `cents`.
 */
export const pitch = defineExtractor<PitchResult, PitchOptions>({
  id: 'pitch',
  deps: [f0],
  columns: ['midi', 'note', 'cents'],
  create(_context, options) {
    const a4 = options?.a4 ?? DEFAULT_A4
    const result: PitchResult = { midi: NaN, note: NaN, cents: NaN }
    return {
      process(_frame, deps, out) {
        const { frequency } = deps.get(f0)
        const midi = hzToMidi(frequency, a4)
        result.midi = midi
        result.note = nearestMidi(midi)
        result.cents = centsOffNearest(midi)
        out.set('midi', result.midi)
        out.set('note', result.note)
        out.set('cents', result.cents)
        return result
      },
    }
  },
})
