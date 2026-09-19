/**
 * A built training run on the exercise clock. One bar counts in, then the training's bars follow in
 * the order they are sung (reprises unrolled) and start over when they run out; every run through is
 * a pass. Lengths turn into beats of the meter; each note is judged by pitch, timing and — when the
 * training sets one — loudness.
 */
import type { NoteEvent } from '@audio-core/core/index'
import {
  LOUDNESS_ZONES,
  breathAnchor,
  expandBars,
  isBreath,
  isNote,
  pitchOf,
  sixteenthsPerBeat,
  type BarElement,
  type LoudnessZone,
  type TrainingDraft,
} from '@/training/builder'

/** Bars of clicks before the first bar of the training. */
export const COUNT_IN_BARS = 1
/** Pitch error still counted as the note, cents; the octave sung does not matter. */
export const PITCH_TOLERANCE_CENTS = 50
/** Onset error still counted as on time, seconds. */
export const RHYTHM_TOLERANCE_SECONDS = 0.12

/** One element of the training laid out in time: a note, a rest or a breath. */
export interface RunElement {
  readonly element: BarElement
  /** Bar of the unrolled training it is in, 0-based. */
  readonly bar: number
  /** Beats from the start of its bar. */
  readonly offset: number
  readonly beats: number
  /** Pitch sung straight after it, for slides: the next element's, wrapping to the first. */
  readonly next: number | null
  /** For a breath: the pitch it hangs from (see `breathAnchor`). */
  readonly anchor: number | null
}

export interface RunPlan {
  /** Bars in one pass, reprises unrolled. */
  readonly bars: number
  readonly beatsPerBar: number
  /** Elements of each bar, by bar of the pass. */
  readonly byBar: readonly (readonly RunElement[])[]
  /** Every pitched note in a pass. */
  readonly noteCount: number
}

export function planRun(draft: TrainingDraft): RunPlan {
  const played = expandBars(
    draft.bars.map((bar) => bar.elements),
    draft.repeats,
  )
  const perBeat = sixteenthsPerBeat(draft.beats)
  const flat = played.flatMap((elements, bar) => elements.map((element) => ({ element, bar })))
  const elements = flat.map((item) => item.element)
  const byBar: RunElement[][] = played.map(() => [])
  let at = 0
  let barStart = 0
  let currentBar = 0
  flat.forEach(({ element, bar }, index) => {
    if (bar !== currentBar) {
      currentBar = bar
      barStart = at
    }
    byBar[bar]!.push({
      element,
      bar,
      offset: (at - barStart) / perBeat,
      beats: element.sixteenths / perBeat,
      next: pitchOf(elements[(index + 1) % elements.length]),
      anchor: isBreath(element) ? breathAnchor(elements, index) : null,
    })
    at += element.sixteenths
  })
  return {
    bars: played.length,
    beatsPerBar: draft.beats,
    byBar,
    noteCount: elements.filter(isNote).length,
  }
}

/** Beat on the clock where training bar `sequence` (counted across passes) starts. */
export function runBarBeat(plan: RunPlan, sequence: number): number {
  return (sequence + COUNT_IN_BARS) * plan.beatsPerBar
}

/** The elements of training bar `sequence` (counted across passes). */
export function runBarElements(plan: RunPlan, sequence: number): readonly RunElement[] {
  if (plan.bars === 0 || sequence < 0) return []
  return plan.byBar[sequence % plan.bars] ?? []
}

/** The pitched notes of training bar `sequence` as note events on the clock. */
export function runBarNotes(plan: RunPlan, sequence: number, velocity = 1): NoteEvent[] {
  const start = runBarBeat(plan, sequence)
  return runBarElements(plan, sequence).flatMap(({ element, offset, beats }) =>
    isNote(element)
      ? [{ midi: element.midi, startBeat: start + offset, durationBeats: beats, velocity }]
      : [],
  )
}

/** Pass that training bar `sequence` (counted across passes) belongs to. */
export function passOf(plan: RunPlan, sequence: number): number {
  return plan.bars === 0 ? 0 : Math.floor(sequence / plan.bars)
}

/** Cents off a target, folded into [−600, 600): singing an octave away is still the note. */
export function foldCents(cents: number): number {
  return ((((cents + 600) % 1200) + 1200) % 1200) - 600
}

export interface NoteResult {
  /** Sequence number of the bar it was sung in, across passes. */
  readonly sequence: number
  readonly midi: number
  /** Pitch error folded into one octave, cents; null when nothing was sung. */
  readonly cents: number | null
  /** Onset error, seconds, positive late; null when nothing was sung. */
  readonly offsetSeconds: number | null
  readonly inTune: boolean
  readonly onTime: boolean
  /** Whether the loudness sat in the training's zone; null when the training sets none. */
  readonly loudOk: boolean | null
}

export function judgeNote(
  sequence: number,
  midi: number,
  cents: number | null,
  offsetSeconds: number | null,
  loudOk: boolean | null,
): NoteResult {
  const folded = cents === null ? null : foldCents(cents)
  return {
    sequence,
    midi,
    cents: folded,
    offsetSeconds,
    inTune: folded !== null && Math.abs(folded) <= PITCH_TOLERANCE_CENTS,
    onTime: offsetSeconds !== null && Math.abs(offsetSeconds) <= RHYTHM_TOLERANCE_SECONDS,
    loudOk,
  }
}

/** A note is a hit when everything the training asks of it is right. */
export function isHit(result: NoteResult): boolean {
  return result.inTune && result.onTime && result.loudOk !== false
}

/** A hit, a note right in pitch or in time only, or a miss. */
export function gradeNote(result: NoteResult): 'hit' | 'near' | 'miss' {
  if (isHit(result)) return 'hit'
  if (result.inTune || result.onTime) return 'near'
  return 'miss'
}

/** Whether a mean loudness (meter scale, 0…1) sits in the zone; null without a zone. */
export function inLoudnessZone(zone: LoudnessZone | null, level: number | null): boolean | null {
  if (zone === null) return null
  const option = LOUDNESS_ZONES.find((candidate) => candidate.zone === zone)
  if (option === undefined || level === null) return false
  return option.low <= level && level <= option.high
}

export interface PassSummary {
  readonly pass: number
  readonly notes: number
  readonly hits: number
  readonly inTune: number
  readonly onTime: number
  /** Notes in the loudness zone; null when the training sets none. */
  readonly loud: number | null
}

export function summarize(
  pass: number,
  results: readonly NoteResult[],
  withLoudness: boolean,
): PassSummary {
  return {
    pass,
    notes: results.length,
    hits: results.filter(isHit).length,
    inTune: results.filter((result) => result.inTune).length,
    onTime: results.filter((result) => result.onTime).length,
    loud: withLoudness ? results.filter((result) => result.loudOk === true).length : null,
  }
}
