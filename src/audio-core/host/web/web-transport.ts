/**
 * Lookahead scheduler on `AudioContext.currentTime` (Chris Wilson, “A Tale of Two Clocks”).
 *
 * A 25 ms timer asks the platform-agnostic metronome/reference planners for the next 100 ms of
 * events and hands them to `WebSynth` with audio-clock timestamps. Beat 0 is `origin` (default:
 * a short delay after `start`), so scoring can use the same `BeatGrid` with `origin: 0` plus the
 * recorded `audioOrigin`.
 */

import type { BeatGrid } from '../../core/clock/beat-grid'
import type { NoteEvent } from '../../core/model/note'
import { metronomeClicks, type ClickEvent } from '../../core/synthesis/metronome'
import { referenceTriggers } from '../../core/synthesis/reference'
import { WebSynth } from './web-synth'

const LOOKAHEAD_MS = 25
const HORIZON_S = 0.1
const START_DELAY_S = 0.08

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
  private grid: BeatGrid | undefined
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
    this.grid = options.grid
    this.clicks = options.metronome !== false
    this.notes = options.notes ?? []
    this.onClick = options.onClick
    this.scheduled = []
    this.cursor = 0
    this.audioOrigin = this.context.currentTime + START_DELAY_S
    this.tick()
    this.timer = window.setInterval(() => this.tick(), LOOKAHEAD_MS)
  }

  stop(): void {
    if (this.timer !== null) {
      window.clearInterval(this.timer)
      this.timer = null
    }
    this.synth.stop()
    this.grid = undefined
  }

  private tick(): void {
    if (this.grid === undefined) return
    const to = this.context.currentTime + HORIZON_S - this.audioOrigin
    if (to <= this.cursor) return
    const from = this.cursor
    this.cursor = to
    if (this.clicks) {
      for (const click of metronomeClicks(this.grid, from, to)) {
        this.synth.click(this.audioOrigin + click.time, click.accent)
        this.scheduled.push(click)
        this.onClick?.(click)
      }
    }
    if (this.notes.length > 0) {
      for (const trigger of referenceTriggers(this.grid, this.notes, from, to)) {
        if (trigger.kind !== 'on') continue
        const duration = this.grid.secondsPerBeat * trigger.note.durationBeats
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
