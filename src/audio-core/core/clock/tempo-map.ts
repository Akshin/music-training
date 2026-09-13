/**
 * A beat grid whose tempo and meter can change while it plays.
 *
 * A change lands on the first beat at or after the moment it is requested, so it is always heard on
 * a beat. A tempo change keeps beat and bar numbering running; a meter change starts a new epoch
 * whose first beat is bar 0, beat 0 — the next click is a downbeat. Pure arithmetic like
 * `BeatGrid`: the host scheduler owns "now" and asks for windows of it.
 */

import { BeatGrid, type BarPosition, type BeatGridSpec } from './beat-grid'

export interface GridSegment {
  /** Grid time in seconds from which `grid` is in effect. The first segment starts at -Infinity. */
  readonly start: number
  readonly grid: BeatGrid
  /** Increments on every meter change; beat and bar numbering restart with it. */
  readonly epoch: number
}

export interface GridWindow {
  readonly from: number
  readonly to: number
  readonly grid: BeatGrid
}

export interface MapPosition extends BarPosition {
  readonly epoch: number
  /** The grid in effect at that moment. */
  readonly grid: BeatGrid
}

export type GridChange = Omit<BeatGridSpec, 'origin'>

export class TempoMap {
  private readonly segments: GridSegment[]

  constructor(grid: BeatGrid) {
    this.segments = [{ start: -Infinity, grid, epoch: 0 }]
  }

  segmentAt(seconds: number): GridSegment {
    for (let i = this.segments.length - 1; i > 0; i--) {
      if (this.segments[i].start <= seconds) return this.segments[i]
    }
    return this.segments[0]
  }

  positionAt(seconds: number): MapPosition {
    const { grid, epoch } = this.segmentAt(seconds)
    return { ...grid.positionAt(seconds), epoch, grid }
  }

  /**
   * Request a new tempo and/or meter from `fromSeconds` on. Changes that would take effect after
   * `fromSeconds` are dropped first, so a knob dragged within one beat lands once. Returns the grid
   * time the change takes effect, or `undefined` if the grid in effect already matches.
   */
  change(fromSeconds: number, spec: GridChange): number | undefined {
    while (this.segments.length > 1 && this.last.start > fromSeconds) this.segments.pop()
    const base = this.last
    const meter = spec.meter ?? base.grid.meter
    const sameMeter =
      meter.beatsPerBar === base.grid.meter.beatsPerBar &&
      meter.beatUnit === base.grid.meter.beatUnit
    if (sameMeter && spec.bpm === base.grid.bpm) return undefined

    const beat = Math.ceil(base.grid.secondsToBeat(fromSeconds) - 1e-9)
    const start = base.grid.beatToSeconds(beat)
    // Same meter: keep counting, so `beat` stays `beat` at the new tempo. New meter: it is beat 0.
    const origin = sameMeter ? start - (beat * 60) / spec.bpm : start
    const grid = new BeatGrid({ bpm: spec.bpm, meter, origin })
    if (start === base.start) this.segments.pop()
    this.segments.push({ start, grid, epoch: sameMeter ? base.epoch : base.epoch + 1 })
    return start
  }

  /** `[from, to)` split at segment boundaries, each part with the grid in effect there. */
  windows(from: number, to: number): GridWindow[] {
    const out: GridWindow[] = []
    for (let i = 0; i < this.segments.length; i++) {
      const next = this.segments[i + 1]
      const lo = Math.max(from, this.segments[i].start)
      const hi = Math.min(to, next === undefined ? Infinity : next.start)
      if (lo < hi) out.push({ from: lo, to: hi, grid: this.segments[i].grid })
    }
    return out
  }

  /** Forget segments that ended at or before `seconds`. */
  prune(seconds: number): void {
    while (this.segments.length > 1 && this.segments[1].start <= seconds) this.segments.shift()
  }

  private get last(): GridSegment {
    return this.segments[this.segments.length - 1]
  }
}
