/**
 * Reference melody triggers on a BeatGrid.
 *
 * The same `NoteEvent[]` is what the synth plays and what scoring compares against. On and off
 * times are derived from the grid, so a tempo change moves both together.
 */

import { noteEnd, type NoteEvent } from '../model/note'
import type { BeatGrid } from '../clock/beat-grid'

export interface NoteTrigger {
  readonly kind: 'on' | 'off'
  readonly time: number
  readonly note: NoteEvent
}

export function referenceTriggers(
  grid: BeatGrid,
  notes: readonly NoteEvent[],
  fromSeconds: number,
  toSeconds: number,
): NoteTrigger[] {
  const events: NoteTrigger[] = []
  for (const note of notes) {
    const on = grid.beatToSeconds(note.startBeat)
    const off = grid.beatToSeconds(noteEnd(note))
    if (on >= fromSeconds && on < toSeconds) events.push({ kind: 'on', time: on, note })
    if (off >= fromSeconds && off < toSeconds && off > on)
      events.push({ kind: 'off', time: off, note })
  }
  events.sort((a, b) => a.time - b.time || (a.kind === 'off' ? -1 : 1))
  return events
}

/** C major arpeggio, one beat per note — the default `/lab` reference. */
export function majorArpeggio(startBeat = 0): NoteEvent[] {
  return [60, 64, 67, 72].map((midi, i) => ({
    midi,
    startBeat: startBeat + i,
    durationBeats: 1,
    velocity: 0.7,
  }))
}
