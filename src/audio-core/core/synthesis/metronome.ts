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

/** A pulse of the metronome's second layer. */
export interface PulseEvent {
  /** Session/grid time in seconds. */
  readonly time: number
  /** Cycle of `beats` beats the pulse belongs to, counted from the grid origin. */
  readonly cycle: number
  /** Pulse inside its cycle, `0 … count-1`; 0 falls on the cycle's first beat. */
  readonly index: number
}

/**
 * The second layer: `count` even pulses over every `beats` beats, cycles starting on beat 0 — 2
 * over 1 is eighths, 3 over 1 triplets, 3 over 2 the three-against-two polyrhythm. The pulse that
 * starts a cycle is included, so the layer holds the time on its own when the beat clicks are off.
 */
export function pulseClicks(
  grid: BeatGrid,
  fromSeconds: number,
  toSeconds: number,
  count: number,
  beats = 1,
): PulseEvent[] {
  const pulses = Math.max(1, Math.round(count))
  const span = Math.max(1, Math.round(beats))
  const perBeat = pulses / span
  const first = Math.ceil(grid.secondsToBeat(fromSeconds) * perBeat - 1e-9)
  const end = Math.ceil(grid.secondsToBeat(toSeconds) * perBeat - 1e-9)
  const events: PulseEvent[] = []
  for (let pulse = first; pulse < end; pulse++) {
    const cycle = Math.floor(pulse / pulses)
    events.push({
      time: grid.beatToSeconds((pulse * span) / pulses),
      cycle: cycle + 0,
      index: pulse - cycle * pulses,
    })
  }
  return events
}
