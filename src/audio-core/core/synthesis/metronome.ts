/**
 * Metronome clicks on a BeatGrid.
 *
 * Pure: given a time window it returns the clicks that fall in it. The host lookahead scheduler
 * (Chris Wilson) asks for `[now, now + 100ms)` on the audio clock; tests ask for a whole bar.
 */

import type { BeatGrid, Meter } from '../clock/beat-grid'

/**
 * How strongly a click is accented: the downbeat, the first beat of a group inside the bar
 * (beat 4 of 6/8), or any other beat.
 */
export type ClickLevel = 'bar' | 'group' | 'beat'

export interface ClickEvent {
  /** Integer beat index from the grid origin. */
  readonly beat: number
  /** Session/grid time in seconds. */
  readonly time: number
  readonly level: ClickLevel
  readonly bar: number
  /** Beat inside the bar, `0 … beatsPerBar-1`. */
  readonly beatInBar: number
}

/**
 * Beats per accent group inside a bar. Compound meters (6/8, 9/8, 12/8) are felt in dotted
 * quarters, so their eighths group in threes; every other meter is a single group.
 */
export function beatsPerGroup(meter: Meter): number {
  const { beatsPerBar, beatUnit } = meter
  return beatUnit === 8 && beatsPerBar > 3 && beatsPerBar % 3 === 0 ? 3 : beatsPerBar
}

export function metronomeClicks(
  grid: BeatGrid,
  fromSeconds: number,
  toSeconds: number,
): ClickEvent[] {
  const { beatsPerBar } = grid.meter
  const group = beatsPerGroup(grid.meter)
  return grid.beatsInRange(fromSeconds, toSeconds).map((beat): ClickEvent => {
    const beatInBar = ((beat % beatsPerBar) + beatsPerBar) % beatsPerBar
    return {
      beat: beat === 0 ? 0 : beat,
      time: grid.beatToSeconds(beat),
      level: beatInBar === 0 ? 'bar' : beatInBar % group === 0 ? 'group' : 'beat',
      bar: Math.floor(beat / beatsPerBar),
      beatInBar,
    }
  })
}
