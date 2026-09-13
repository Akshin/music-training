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
import {
  TempoMap,
  type GridChange,
  type GridWindow,
  type MapPosition,
} from '../../core/clock/tempo-map'
import type { NoteEvent } from '../../core/model/note'
import { metronomeClicks, type ClickEvent } from '../../core/synthesis/metronome'
import { referenceTriggers } from '../../core/synthesis/reference'
import { WebSynth } from './web-synth'

const LOOKAHEAD_MS = 25
const HORIZON_S = 0.1
const START_DELAY_S = 0.08
/** Tempo segments and note-on records older than this are forgotten. */
const HISTORY_S = 2

export interface TransportOptions {
  readonly grid: BeatGrid
  readonly metronome?: boolean
  readonly notes?: readonly NoteEvent[]
  /** Tempo-map epoch the note beats count in (see `retime`). Default 0. */
  readonly notesEpoch?: number
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
  private notesEpoch = 0
  /** Note-ons handed to the synth, keyed by epoch/beat/pitch, with their grid time. */
  private readonly notesScheduled = new Map<string, number>()
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
    this.notesEpoch = options.notesEpoch ?? 0
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
   * A meter change restarts bar numbering there, in a new epoch.
   */
  retime(change: GridChange): number | undefined {
    const at = this.map?.change(this.cursor, change)
    return at === undefined ? undefined : this.audioOrigin + at
  }

  /** Clicks on or off from the next scheduled window; the grid keeps running either way. */
  setMetronome(on: boolean): void {
    this.clicks = on
  }

  /**
   * Replace the reference notes, their beats counted within tempo-map `epoch`. Note-ons of the new
   * list that fall in the stretch already scheduled are scheduled at once, so notes handed over a
   * moment late still start on time; a note-on is never scheduled twice.
   */
  setNotes(notes: readonly NoteEvent[], epoch = 0): void {
    this.notes = notes
    this.notesEpoch = epoch
    if (this.map === undefined) return
    const now = this.context.currentTime - this.audioOrigin
    for (const span of this.map.windows(now, this.cursor)) this.scheduleNotes(span)
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
    this.notesScheduled.clear()
  }

  private tick(): void {
    if (this.map === undefined) return
    const now = this.context.currentTime - this.audioOrigin
    const to = now + HORIZON_S
    if (to <= this.cursor) return
    for (const span of this.map.windows(this.cursor, to)) {
      if (this.clicks) this.scheduleClicks(span.grid, span.from, span.to)
      this.scheduleNotes(span)
    }
    this.cursor = to
    this.map.prune(now - HISTORY_S)
    for (const [key, time] of this.notesScheduled) {
      if (time < now - HISTORY_S) this.notesScheduled.delete(key)
    }
  }

  private scheduleClicks(grid: BeatGrid, from: number, to: number): void {
    for (const click of metronomeClicks(grid, from, to)) {
      this.synth.click(this.audioOrigin + click.time, click.level)
      this.scheduled.push(click)
      this.onClick?.(click)
    }
  }

  private scheduleNotes({ grid, from, to, epoch }: GridWindow): void {
    if (epoch !== this.notesEpoch || this.notes.length === 0) return
    for (const trigger of referenceTriggers(grid, this.notes, from, to)) {
      if (trigger.kind !== 'on') continue
      const key = `${epoch}|${trigger.note.startBeat}|${trigger.note.midi}`
      if (this.notesScheduled.has(key)) continue
      this.notesScheduled.set(key, trigger.time)
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
