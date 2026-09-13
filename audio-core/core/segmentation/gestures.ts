/**
 * Pitch-gesture labels on already segmented notes.
 *
 * `vibrato` wins when the note's vibrato columns show a 4–12 Hz wobble. Otherwise the contour
 * drift of the first vs last third decides `scoop` (starts below) / `fall` (ends below) /
 * `straight`. Separate from `NoteSegment` so greedy and Mauch notes share one shape.
 */

import type { Timeline } from '../model/timeline'
import { median } from './notes'
import type { NoteSegment } from './types'

export type PitchGesture = 'straight' | 'vibrato' | 'scoop' | 'fall'

export interface GestureOptions {
  readonly midiColumn?: string
  readonly rateColumn?: string
  readonly extentColumn?: string
  /** Median extent at or above this (cents) counts as vibrato. Default 25. */
  readonly minVibratoExtent?: number
  /** First/last-third drift at or above this (semitones) is a scoop or fall. Default 0.4. */
  readonly minDrift?: number
}

export interface NoteGesture {
  readonly noteIndex: number
  readonly gesture: PitchGesture
  readonly vibratoRate: number
  readonly vibratoExtent: number
  /** Last-third mean minus first-third mean, cents. */
  readonly driftCents: number
}

const DEFAULTS = {
  midiColumn: 'midi',
  rateColumn: 'vibratoRate',
  extentColumn: 'vibratoExtent',
  minVibratoExtent: 25,
  minDrift: 0.4,
} as const

function mean(values: readonly number[]): number {
  if (values.length === 0) return NaN
  let sum = 0
  for (const v of values) sum += v
  return sum / values.length
}

function voicedMidi(timeline: Timeline, column: string, from: number, to: number): number[] {
  const values: number[] = []
  for (let i = from; i < to; i++) {
    const midi = timeline.get(column, i)
    if (Number.isFinite(midi)) values.push(midi)
  }
  return values
}

function classifyOne(
  timeline: Timeline,
  note: NoteSegment,
  index: number,
  options: GestureOptions,
): NoteGesture {
  const midiColumn = options.midiColumn ?? DEFAULTS.midiColumn
  const rateColumn = options.rateColumn ?? DEFAULTS.rateColumn
  const extentColumn = options.extentColumn ?? DEFAULTS.extentColumn
  const minExtent = options.minVibratoExtent ?? DEFAULTS.minVibratoExtent
  const minDrift = options.minDrift ?? DEFAULTS.minDrift

  const contour = voicedMidi(timeline, midiColumn, note.startFrame, note.endFrame)
  const third = Math.max(1, Math.floor(contour.length / 3))
  const head = mean(contour.slice(0, third))
  const tail = mean(contour.slice(Math.max(0, contour.length - third)))
  const mid = median(contour)
  const rise = mid - head
  const drop = mid - tail
  const driftCents = Number.isFinite(tail) && Number.isFinite(head) ? (tail - head) * 100 : 0

  let vibratoRate = NaN
  let vibratoExtent = NaN
  if (timeline.columns.includes(rateColumn) && timeline.columns.includes(extentColumn)) {
    const rates: number[] = []
    const extents: number[] = []
    for (let i = note.startFrame; i < note.endFrame; i++) {
      const rate = timeline.get(rateColumn, i)
      const extent = timeline.get(extentColumn, i)
      if (rate >= 4 && rate <= 12 && extent >= minExtent) {
        rates.push(rate)
        extents.push(extent)
      }
    }
    if (rates.length >= 3) {
      vibratoRate = median(rates)
      vibratoExtent = median(extents)
    }
  }

  let gesture: PitchGesture = 'straight'
  if (Number.isFinite(vibratoExtent)) gesture = 'vibrato'
  else if (rise >= minDrift && rise >= drop) gesture = 'scoop'
  else if (drop >= minDrift) gesture = 'fall'

  return { noteIndex: index, gesture, vibratoRate, vibratoExtent, driftCents }
}

/** One label per note, in `notes` order. */
export function classifyGestures(
  timeline: Timeline,
  notes: readonly NoteSegment[],
  options: GestureOptions = {},
): NoteGesture[] {
  return notes.map((note, index) => classifyOne(timeline, note, index, options))
}
