/**
 * Lookahead scheduler on `AudioContext.currentTime` (Chris Wilson, “A Tale of Two Clocks”).
 *
 * A 25 ms timer asks the platform-agnostic metronome/reference planners for the next 100 ms of
 * events and hands them to `WebSynth` with audio-clock timestamps. Beat 0 is `origin` (default:
 * a short delay after `start`), so scoring can use the same `BeatGrid` with `origin: 0` plus the
 * recorded `audioOrigin`. Tempo and meter change on the fly through a core `TempoMap`, so what is
 * scheduled and what `positionAt` reports come from the same grids.
 */

import type { BeatGrid } from '../../core/clock/beat-grid'
import { TempoMap, type GridChange, type MapPosition } from '../../core/clock/tempo-map'
import type { NoteEvent } from '../../core/model/note'
import { metronomeClicks, type ClickEvent } from '../../core/synthesis/metronome'
import { referenceTriggers } from '../../core/synthesis/reference'
import { WebSynth } from './web-synth'

const LOOKAHEAD_MS = 25
const HORIZON_S = 0.1
const START_DELAY_S = 0.08
/** Tempo segments that ended this long ago are forgotten. */
const HISTORY_S = 2

export interface TransportOptions {
  readonly grid: BeatGrid
  readonly metronome?: boolean
  readonly notes?: readonly NoteEvent[]
  readonly onClick?: (event: ClickEvent) => void
}

export class WebTransport {
  readonly synth: WebSynth
  /** `AudioContext.currentTime` of grid t = 0. */
  audioOrigin = 0
  private readonly context: AudioContext
  private timer: number | null = null
  private cursor = 0
  private map: TempoMap | undefined
  private clicks = false
  private notes: readonly NoteEvent[] = []
  private onClick: ((event: ClickEvent) => void) | undefined
  private scheduled: ClickEvent[] = []

  constructor(context: AudioContext, synth = new WebSynth(context)) {
    this.context = context
    this.synth = synth
  }

  get running(): boolean {
    return this.timer !== null
  }

  /** Clicks scheduled since `start()`, grid times. */
  get clicksScheduled(): readonly ClickEvent[] {
    return this.scheduled
  }

  async start(options: TransportOptions): Promise<void> {
    this.stop()
    if (this.context.state !== 'running') await this.context.resume()
    // Another start() may have finished while this one waited for the context.
    this.stop()
    this.map = new TempoMap(options.grid)
    this.clicks = options.metronome !== false
    this.notes = options.notes ?? []
    this.onClick = options.onClick
    this.scheduled = []
    this.cursor = 0
    this.audioOrigin = this.context.currentTime + START_DELAY_S
    this.tick()
    this.timer = window.setInterval(() => this.tick(), LOOKAHEAD_MS)
  }

  /**
   * Change tempo and/or meter without stopping. Lands on the first beat not yet scheduled; returns
   * that moment on the audio clock, or `undefined` if nothing changes or the transport is stopped.
   * A meter change restarts bar numbering there (and a reference melody with it).
   */
  retime(change: GridChange): number | undefined {
    const at = this.map?.change(this.cursor, change)
    return at === undefined ? undefined : this.audioOrigin + at
  }

  /** Musical position at an `AudioContext` time, or `undefined` when stopped. */
  positionAt(contextTime: number): MapPosition | undefined {
    return this.map?.positionAt(contextTime - this.audioOrigin)
  }

  stop(): void {
    if (this.timer !== null) {
      window.clearInterval(this.timer)
      this.timer = null
    }
    this.synth.stop()
    this.map = undefined
  }

  private tick(): void {
    if (this.map === undefined) return
    const now = this.context.currentTime - this.audioOrigin
    const to = now + HORIZON_S
    if (to <= this.cursor) return
    for (const span of this.map.windows(this.cursor, to))
      this.schedule(span.grid, span.from, span.to)
    this.cursor = to
    this.map.prune(now - HISTORY_S)
  }

  private schedule(grid: BeatGrid, from: number, to: number): void {
    if (this.clicks) {
      for (const click of metronomeClicks(grid, from, to)) {
        this.synth.click(this.audioOrigin + click.time, click.level)
        this.scheduled.push(click)
        this.onClick?.(click)
      }
    }
    if (this.notes.length > 0) {
      for (const trigger of referenceTriggers(grid, this.notes, from, to)) {
        if (trigger.kind !== 'on') continue
        const duration = grid.secondsPerBeat * trigger.note.durationBeats
        this.synth.note(
          this.audioOrigin + trigger.time,
          trigger.note.midi,
          duration,
          trigger.note.velocity ?? 0.7,
        )
      }
    }
  }
}
