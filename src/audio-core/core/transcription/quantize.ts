/**
 * Sung notes onto the beat grid: seconds become whole steps of the grid, pitch a tempered note.
 *
 * The segmenter says what was sung and when in seconds; this says where it sits in the music. An
 * onset snaps to the nearest step. A note lasts until it stops sounding — or, when the next one is
 * entered legato or by a slide, until that one starts, so a line sung in one breath has no rests in
 * it. The take is monophonic: a note is cut where the next begins. Two notes that snap to the same
 * step are faster than the grid; the longer one keeps the step and the other is reported in
 * `dropped`, never silently lost. A slide that carries a note straight into the next is kept as
 * `slideTo`.
 *
 * Timing is only as good as `latencySeconds`: an offset of half a step or more moves every note by
 * a step.
 */

import type { BeatGrid } from '../clock/beat-grid'
import type { NoteEvent } from '../model/note'
import type { NoteSegment, Slide } from '../segmentation/types'

export interface QuantizeOptions {
  /** Grid step, beats. Default 0.25 — a sixteenth when the beat is a quarter. */
  readonly stepBeats?: number
  /** Subtracted from sung times before snapping (see `estimateLatency`). Default 0. */
  readonly latencySeconds?: number
  /** Round the pitch to the nearest tempered note. Default true; false keeps the sung median. */
  readonly tune?: boolean
  /** Keep only notes whose onset snaps into `[fromBeat, toBeat)`; a note is cut at `toBeat`. */
  readonly fromBeat?: number
  readonly toBeat?: number
}

/** A sung note on the grid. `startBeat` and `durationBeats` are whole steps. */
export interface GridNote extends NoteEvent {
  /** Onset, in steps from the grid origin. */
  readonly startStep: number
  /** Length in steps, at least 1. */
  readonly steps: number
  /** The pitch it glides into, when a slide carries it straight into the next note. */
  readonly slideTo: number | undefined
  /** How far the sung onset sat from its step, seconds; positive = late. */
  readonly offsetSeconds: number
  /** Index of the sung note this came from. */
  readonly source: number
}

export interface GridTranscription {
  readonly notes: readonly GridNote[]
  /** Indices of sung notes that lost their step to a longer one: faster than the grid. */
  readonly dropped: readonly number[]
  readonly stepBeats: number
}

const DEFAULTS = {
  stepBeats: 0.25,
  latencySeconds: 0,
} as const

interface Placed {
  readonly source: number
  readonly start: number
  end: number
  readonly sungSeconds: number
  readonly offsetSeconds: number
}

/** `sung` and `slides` as `segmentTake` returns them: notes in time order, slides by note index. */
export function quantizeNotes(
  sung: readonly NoteSegment[],
  slides: readonly Slide[],
  grid: BeatGrid,
  options: QuantizeOptions = {},
): GridTranscription {
  const stepBeats = options.stepBeats ?? DEFAULTS.stepBeats
  if (!(stepBeats > 0)) throw new RangeError(`stepBeats must be positive, got ${stepBeats}`)
  const latency = options.latencySeconds ?? DEFAULTS.latencySeconds
  const tune = options.tune ?? true
  const stepSeconds = stepBeats * grid.secondsPerBeat
  const stepAt = (seconds: number) => grid.secondsToBeat(seconds - latency) / stepBeats
  const firstStep =
    options.fromBeat === undefined ? -Infinity : wholeStep(options.fromBeat, stepBeats)
  const endStep = options.toBeat === undefined ? Infinity : wholeStep(options.toBeat, stepBeats)

  const placed: Placed[] = []
  const dropped: number[] = []
  sung.forEach((note, index) => {
    const exact = stepAt(note.startTime)
    const start = nearestStep(exact)
    if (start < firstStep || start >= endStep) return
    // Entered without a break, the next note takes over where this one is still sounding.
    const next = sung[index + 1]
    const joined =
      next !== undefined && (next.transition === 'legato' || next.transition === 'slide')
    const soundsUntil = joined ? Math.max(note.endTime, next.startTime) : note.endTime
    const candidate: Placed = {
      source: index,
      start,
      end: Math.min(endStep, Math.max(start + 1, nearestStep(stepAt(soundsUntil)))),
      sungSeconds: note.duration,
      offsetSeconds: (exact - start) * stepSeconds,
    }
    const previous = placed[placed.length - 1]
    if (previous === undefined || previous.start < start) {
      if (previous !== undefined) previous.end = Math.min(previous.end, start)
      placed.push(candidate)
      return
    }
    // Same step as the note before: only one of them fits, and it sounds for as long as both did.
    const end = Math.max(previous.end, candidate.end)
    if (candidate.sungSeconds > previous.sungSeconds) {
      dropped.push(previous.source)
      placed[placed.length - 1] = { ...candidate, end }
    } else {
      dropped.push(index)
      previous.end = end
    }
  })

  const midiOf = (source: number) => (tune ? sung[source].note : sung[source].midi)
  const notes = placed.map((item, k): GridNote => {
    const after = placed[k + 1]
    const glides =
      after !== undefined &&
      after.start === item.end &&
      slides.some((slide) => slide.fromNote === item.source && slide.toNote === after.source)
    return {
      midi: midiOf(item.source),
      startBeat: item.start * stepBeats,
      durationBeats: (item.end - item.start) * stepBeats,
      startStep: item.start,
      steps: item.end - item.start,
      slideTo: glides ? midiOf(after.source) : undefined,
      offsetSeconds: item.offsetSeconds,
      source: item.source,
    }
  })
  return { notes, dropped: dropped.sort((a, b) => a - b), stepBeats }
}

/** The step a beat falls on; beats are whole steps here, give or take float error. */
function wholeStep(beat: number, stepBeats: number): number {
  return nearestStep(beat / stepBeats)
}

/** `Math.round(-0.2)` is `-0`; step numbers should be ordinary zeros. */
function nearestStep(value: number): number {
  const step = Math.round(value)
  return step === 0 ? 0 : step
}
