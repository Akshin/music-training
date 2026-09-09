/**
 * Metronome clicks on a BeatGrid.
 *
 * Pure: given a time window it returns the clicks that fall in it. The host lookahead scheduler
 * (Chris Wilson) asks for `[now, now + 100ms)` on the audio clock; tests ask for a whole bar.
 */

import type { BeatGrid } from '../clock/beat-grid'

export interface ClickEvent {
  /** Integer beat index from the grid origin. */
  readonly beat: number
  /** Session/grid time in seconds. */
  readonly time: number
  readonly accent: boolean
  readonly bar: number
  /** Beat inside the bar, `0 … beatsPerBar-1`. */
  readonly beatInBar: number
}

export function metronomeClicks(
  grid: BeatGrid,
  fromSeconds: number,
  toSeconds: number,
): ClickEvent[] {
  const { beatsPerBar } = grid.meter
  return grid.beatsInRange(fromSeconds, toSeconds).map((beat) => {
    const beatInBar = ((beat % beatsPerBar) + beatsPerBar) % beatsPerBar
    return {
      beat: beat === 0 ? 0 : beat,
      time: grid.beatToSeconds(beat),
      accent: beatInBar === 0,
      bar: Math.floor(beat / beatsPerBar),
      beatInBar,
    }
  })
}
