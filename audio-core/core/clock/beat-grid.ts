/**
 * Musical time: maps beats to seconds on the session clock and back.
 *
 * Pure arithmetic with no notion of "now". The scheduler that drives a metronome from
 * `AudioContext.currentTime` lives in the host layer and uses this grid; the scoring layer uses the
 * same grid to measure how far an onset landed from its beat, so both sides agree by construction.
 */

export interface Meter {
  /** Beats per bar (the numerator of a time signature). */
  readonly beatsPerBar: number
  /** Note value of one beat (the denominator): 4 = quarter note, 8 = eighth note. */
  readonly beatUnit: number
}

export interface BeatGridSpec {
  /** Beats per minute, where one beat is `meter.beatUnit`. */
  readonly bpm: number
  readonly meter?: Meter
  /** Time in seconds (session clock) of beat 0. Default 0. */
  readonly origin?: number
}

export interface BarPosition {
  /** Bar index from the origin, starting at 0. Negative before the origin. */
  readonly bar: number
  /** Beat index within the bar, `0 ≤ beat < beatsPerBar`. */
  readonly beat: number
  /** Fraction of the current beat elapsed, in [0, 1). */
  readonly phase: number
}

export interface NearestBeat {
  /** Integer beat index from the origin. */
  readonly beat: number
  /** Signed distance from that beat in seconds (positive = late). */
  readonly offsetSeconds: number
  /** The same distance as a fraction of a beat, in [-0.5, 0.5]. */
  readonly offsetBeats: number
}

export const COMMON_TIME: Meter = { beatsPerBar: 4, beatUnit: 4 }

export class BeatGrid {
  readonly bpm: number
  readonly meter: Meter
  readonly origin: number

  constructor(spec: BeatGridSpec) {
    if (!(spec.bpm > 0)) throw new RangeError(`bpm must be positive, got ${spec.bpm}`)
    this.bpm = spec.bpm
    this.meter = spec.meter ?? COMMON_TIME
    this.origin = spec.origin ?? 0
    if (this.meter.beatsPerBar < 1) {
      throw new RangeError(`beatsPerBar must be at least 1, got ${this.meter.beatsPerBar}`)
    }
  }

  get secondsPerBeat(): number {
    return 60 / this.bpm
  }

  get secondsPerBar(): number {
    return this.secondsPerBeat * this.meter.beatsPerBar
  }

  beatToSeconds(beat: number): number {
    return this.origin + beat * this.secondsPerBeat
  }

  secondsToBeat(seconds: number): number {
    return (seconds - this.origin) / this.secondsPerBeat
  }

  barToSeconds(bar: number): number {
    return this.beatToSeconds(bar * this.meter.beatsPerBar)
  }

  positionAt(seconds: number): BarPosition {
    const beats = this.secondsToBeat(seconds)
    const whole = Math.floor(beats)
    const { beatsPerBar } = this.meter
    const bar = Math.floor(whole / beatsPerBar)
    return { bar, beat: whole - bar * beatsPerBar, phase: beats - whole }
  }

  nearestBeat(seconds: number): NearestBeat {
    const beats = this.secondsToBeat(seconds)
    const beat = Math.round(beats)
    const offsetBeats = beats - beat
    return { beat, offsetSeconds: offsetBeats * this.secondsPerBeat, offsetBeats }
  }

  /** Integer beat indices whose time falls in `[fromSeconds, toSeconds)`. */
  beatsInRange(fromSeconds: number, toSeconds: number): number[] {
    const first = zeroish(Math.ceil(this.secondsToBeat(fromSeconds) - 1e-9))
    const end = zeroish(Math.ceil(this.secondsToBeat(toSeconds) - 1e-9))
    const beats: number[] = []
    for (let beat = first; beat < end; beat++) beats.push(zeroish(beat))
    return beats
  }

  /** A grid with the same tempo and meter whose beat 0 is at `originSeconds`. */
  withOrigin(originSeconds: number): BeatGrid {
    return new BeatGrid({ bpm: this.bpm, meter: this.meter, origin: originSeconds })
  }

  withBpm(bpm: number): BeatGrid {
    return new BeatGrid({ bpm, meter: this.meter, origin: this.origin })
  }
}

/** `Math.ceil(-1e-12)` is `-0`; beat indices should be ordinary zeros. */
function zeroish(value: number): number {
  return value === 0 ? 0 : value
}
