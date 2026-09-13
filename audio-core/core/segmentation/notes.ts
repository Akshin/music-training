/**
 * Note segmentation inside a phrase: turns the f0 contour into notes and slides.
 *
 * A note is a stretch of voiced frames that stays within `toleranceCents` of a running centre.
 * Vibrato and ornaments live inside that band; a departure that does not come back within
 * `minNoteMs` ends the note. The next note starts at the first `minNoteMs` window that is stable
 * (span ≤ 2·tolerance). Frames between two notes are the transition: under `legatoMaxMs` is a
 * legato step, more is a slide. A portamento that the greedy pass chopped into a staircase of
 * drifting pseudo-notes is collapsed back into one `Slide` by the post-pass — drift within a note
 * is what separates a glide from a fast run of real notes.
 */

import { centsOffNearest, nearestMidi } from '../model/pitch'
import type { Timeline } from '../model/timeline'
import type { NoteSegment, NoteTransition, Phrase, Slide } from './types'

export interface NoteOptions {
  /** Half-width of the pitch band a note may wander in, cents. Default 60. */
  readonly toleranceCents?: number
  /** Shortest note; also the stability window for confirming a new note, ms. Default 80. */
  readonly minNoteMs?: number
  /** Median filter width for the contour, frames (odd). Default 5. */
  readonly medianFrames?: number
  /** Unvoiced gap a note may bridge when the pitch resumes on centre, ms. Default 120. */
  readonly maxGapMs?: number
  /** Unvoiced stretch that counts as a gap transition (a consonant), ms. Default 40. */
  readonly gapMinMs?: number
  /** Voiced transitions up to this length are legato steps, longer ones slides, ms. Default 120. */
  readonly legatoMaxMs?: number
  /** Running centre is the median of the last this many voiced frames. Default 50. */
  readonly centreFrames?: number
  /** Minimum voiced share of a stability window. Default 0.75. */
  readonly minVoicedShare?: number
  readonly midiColumn?: string
  readonly confidenceColumn?: string
  /** Confidence at or above which a frame is voiced. Default 0.5. */
  readonly voicingThreshold?: number
}

export interface NoteSegmentation {
  readonly notes: NoteSegment[]
  readonly slides: Slide[]
}

const DEFAULTS = {
  toleranceCents: 60,
  minNoteMs: 80,
  medianFrames: 5,
  maxGapMs: 120,
  gapMinMs: 40,
  legatoMaxMs: 120,
  centreFrames: 50,
  minVoicedShare: 0.75,
  midiColumn: 'midi',
  confidenceColumn: 'f0Confidence',
  voicingThreshold: 0.5,
} as const

interface Resolved {
  readonly tolerance: number
  readonly minNote: number
  readonly maxGap: number
  readonly gapMin: number
  readonly legatoMax: number
  readonly centreFrames: number
  readonly minVoicedShare: number
}

/** Local (phrase-relative) note before stats are computed. */
interface RawNote {
  start: number
  end: number
  /** Voiced contour values inside `[start, end)`. */
  values: number[]
}

export function median(values: readonly number[]): number {
  if (values.length === 0) return NaN
  const sorted = Array.from(values).sort((a, b) => a - b)
  const mid = sorted.length >> 1
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

/** Median of voiced neighbours within ±half frames; NaN stays NaN. */
export function medianFilterVoiced(values: Float32Array, width: number): Float32Array {
  const half = Math.max(0, Math.floor(width / 2))
  const out = new Float32Array(values.length)
  const window: number[] = []
  for (let i = 0; i < values.length; i++) {
    if (Number.isNaN(values[i])) {
      out[i] = NaN
      continue
    }
    window.length = 0
    for (let j = Math.max(0, i - half); j <= Math.min(values.length - 1, i + half); j++) {
      if (!Number.isNaN(values[j])) window.push(values[j])
    }
    out[i] = median(window)
  }
  return out
}

function resolve(timeline: Timeline, options: NoteOptions): Resolved {
  const framesPerMs = timeline.frameRate / 1000
  const frames = (ms: number) => Math.max(1, Math.round(ms * framesPerMs))
  return {
    tolerance: (options.toleranceCents ?? DEFAULTS.toleranceCents) / 100,
    minNote: frames(options.minNoteMs ?? DEFAULTS.minNoteMs),
    maxGap: frames(options.maxGapMs ?? DEFAULTS.maxGapMs),
    gapMin: frames(options.gapMinMs ?? DEFAULTS.gapMinMs),
    legatoMax: frames(options.legatoMaxMs ?? DEFAULTS.legatoMaxMs),
    centreFrames: options.centreFrames ?? DEFAULTS.centreFrames,
    minVoicedShare: options.minVoicedShare ?? DEFAULTS.minVoicedShare,
  }
}

/** First index ≥ from whose `minNote` window is voiced enough and spans ≤ 2·tolerance; -1 if none. */
function findStable(contour: Float32Array, from: number, cfg: Resolved): number {
  const { minNote } = cfg
  for (let s = from; s + minNote <= contour.length; s++) {
    if (Number.isNaN(contour[s])) continue
    let voiced = 0
    let min = Infinity
    let max = -Infinity
    for (let i = s; i < s + minNote; i++) {
      const v = contour[i]
      if (Number.isNaN(v)) continue
      voiced++
      if (v < min) min = v
      if (v > max) max = v
    }
    if (voiced >= cfg.minVoicedShare * minNote && max - min <= 2 * cfg.tolerance) return s
  }
  return -1
}

/** Grows a note from `start`; returns the raw note ending where the contour leaves the band. */
function growNote(contour: Float32Array, start: number, cfg: Resolved): RawNote {
  const values: number[] = []
  const recent: number[] = []
  let centre = NaN
  const push = (v: number) => {
    values.push(v)
    recent.push(v)
    if (recent.length > cfg.centreFrames) recent.shift()
    centre = median(recent)
  }

  let end = start
  let i = start
  while (i < contour.length) {
    const v = contour[i]
    if (Number.isNaN(v)) {
      // Unvoiced run: bridge it when the pitch comes back on centre soon enough.
      let j = i
      while (j < contour.length && Number.isNaN(contour[j])) j++
      const gap = j - i
      if (
        j >= contour.length ||
        gap > cfg.maxGap ||
        Math.abs(contour[j] - centre) > cfg.tolerance
      ) {
        break
      }
      i = j
      continue
    }
    if (values.length === 0 || Math.abs(v - centre) <= cfg.tolerance) {
      push(v)
      i++
      end = i
      continue
    }
    // Departure: an ornament comes back within a note-length; otherwise the note ends here.
    let back = -1
    for (let k = i + 1; k < Math.min(contour.length, i + cfg.minNote); k++) {
      const w = contour[k]
      if (!Number.isNaN(w) && Math.abs(w - centre) <= cfg.tolerance) {
        back = k
        break
      }
    }
    if (back < 0) break
    for (let k = i; k < back; k++) if (!Number.isNaN(contour[k])) push(contour[k])
    i = back
    end = i
  }
  return { start, end, values }
}

/** Mean of the last third minus mean of the first third, semitones — how much a note glides. */
function drift(values: readonly number[]): number {
  const third = Math.max(1, Math.floor(values.length / 3))
  if (values.length < 3) return 0
  let head = 0
  let tail = 0
  for (let i = 0; i < third; i++) {
    head += values[i]
    tail += values[values.length - 1 - i]
  }
  return (tail - head) / third
}

interface Stats {
  midi: number
  note: number
  cents: number
  spreadCents: number
}

function stats(values: readonly number[]): Stats {
  const mid = median(values)
  const note = nearestMidi(mid)
  const deviations = values.map((v) => Math.abs(v - mid))
  return {
    midi: mid,
    note,
    cents: centsOffNearest(mid),
    spreadCents: median(deviations) * 100,
  }
}

export function segmentNotes(
  timeline: Timeline,
  phrase: Phrase,
  phraseIndex: number,
  options: NoteOptions = {},
): NoteSegmentation {
  const cfg = resolve(timeline, options)
  const midiColumn = options.midiColumn ?? DEFAULTS.midiColumn
  const confidenceColumn = options.confidenceColumn ?? DEFAULTS.confidenceColumn
  const voicingThreshold = options.voicingThreshold ?? DEFAULTS.voicingThreshold
  const base = phrase.startFrame
  const count = phrase.endFrame - phrase.startFrame

  const raw = timeline.slice(midiColumn, phrase.startFrame, phrase.endFrame)
  if (timeline.columns.includes(confidenceColumn)) {
    const confidence = timeline.slice(confidenceColumn, phrase.startFrame, phrase.endFrame)
    for (let i = 0; i < count; i++) if (confidence[i] < voicingThreshold) raw[i] = NaN
  }
  const contour = medianFilterVoiced(raw, options.medianFrames ?? DEFAULTS.medianFrames)

  // Pass 1: greedy notes.
  const rawNotes: RawNote[] = []
  let cursor = 0
  while (cursor < count) {
    const start = findStable(contour, cursor, cfg)
    if (start < 0) break
    const note = growNote(contour, start, cfg)
    rawNotes.push(note)
    cursor = Math.max(note.end, start + 1)
  }
  dropPassingTones(rawNotes, cfg.minNote)

  // Pass 2: collapse staircases of drifting pseudo-notes into slides.
  type Piece = { kind: 'note'; note: RawNote } | { kind: 'slide'; start: number; end: number }
  const pieces: Piece[] = []
  let k = 0
  while (k < rawNotes.length) {
    const current = rawNotes[k]
    const d = drift(current.values)
    if (Math.abs(d) < cfg.tolerance / 2) {
      pieces.push({ kind: 'note', note: current })
      k++
      continue
    }
    // Drifting note: extend over following adjacent notes drifting the same way.
    const direction = Math.sign(d)
    let last = k
    while (last + 1 < rawNotes.length) {
      const next = rawNotes[last + 1]
      const adjacent = next.start - rawNotes[last].end <= cfg.legatoMax
      const step = Math.sign(median(next.values) - median(rawNotes[last].values))
      const nextDrift = drift(next.values)
      if (!adjacent || step !== direction) break
      if (Math.abs(nextDrift) < cfg.tolerance / 2) break
      last++
    }
    pieces.push({ kind: 'slide', start: current.start, end: rawNotes[last].end })
    k = last + 1
  }

  // Assemble notes, transitions and slides.
  const notes: NoteSegment[] = []
  const slides: Slide[] = []
  const span = (start: number, end: number) => {
    const startFrame = base + start
    const endFrame = base + end
    const startTime = timeline.frameTime(startFrame)
    const endTime = timeline.frameTime(endFrame)
    return { startFrame, endFrame, startTime, endTime, duration: endTime - startTime }
  }
  const valueAt = (index: number): number => {
    for (let i = index; i >= 0; i--) if (!Number.isNaN(contour[i])) return contour[i]
    return NaN
  }
  const unvoicedBetween = (from: number, to: number): number => {
    let n = 0
    for (let i = from; i < to; i++) if (Number.isNaN(contour[i])) n++
    return n
  }

  // The stretch between two notes decides how the second one was entered.
  const classify = (from: number, to: number, staircase: boolean): NoteTransition => {
    if (unvoicedBetween(from, to) > cfg.gapMin) return 'gap'
    if (staircase || to - from > cfg.legatoMax) return 'slide'
    return 'legato'
  }

  let previousEnd = -1
  let staircase: { start: number; end: number } | null = null
  for (const piece of pieces) {
    if (piece.kind === 'slide') {
      staircase = { start: piece.start, end: piece.end }
      continue
    }
    const { note } = piece
    const s = stats(note.values)
    let transition: NoteTransition = 'attack'
    if (notes.length === 0) {
      if (staircase !== null) {
        // Scoop into the first note of the phrase.
        transition = 'slide'
        slides.push({
          ...span(staircase.start, note.start),
          phrase: phraseIndex,
          fromMidi: valueAt(staircase.start),
          toMidi: s.midi,
          fromNote: -1,
          toNote: 0,
        })
      }
    } else {
      transition = classify(previousEnd, note.start, staircase !== null)
      if (transition === 'slide') {
        slides.push({
          ...span(previousEnd, note.start),
          phrase: phraseIndex,
          fromMidi: notes[notes.length - 1].midi,
          toMidi: s.midi,
          fromNote: notes.length - 1,
          toNote: notes.length,
        })
      }
    }
    staircase = null
    notes.push({
      ...span(note.start, note.end),
      phrase: phraseIndex,
      midi: s.midi,
      note: s.note,
      cents: s.cents,
      spreadCents: s.spreadCents,
      voicedFrames: note.values.length,
      transition,
    })
    previousEnd = note.end
  }

  // Glide out of the last note into silence (a staircase or a departure that never settled).
  if (notes.length > 0) {
    let tail = staircase === null ? count : staircase.end
    while (tail > previousEnd && Number.isNaN(contour[tail - 1])) tail--
    const last = notes[notes.length - 1]
    const toMidi = valueAt(tail - 1)
    if (
      tail - previousEnd > cfg.legatoMax &&
      unvoicedBetween(previousEnd, tail) <= cfg.legatoMax &&
      Math.abs(toMidi - last.midi) >= cfg.tolerance
    ) {
      slides.push({
        ...span(previousEnd, tail),
        phrase: phraseIndex,
        fromMidi: last.midi,
        toMidi,
        fromNote: notes.length - 1,
        toNote: undefined,
      })
    }
  }

  return { notes, slides }
}

/**
 * Analysis windows smear pitch across a legato step, and the greedy pass can mint a short
 * chromatic "note" in the smear. Drop it when it sits between two longer notes and its pitch is
 * strictly between theirs.
 */
function dropPassingTones(notes: RawNote[], minNote: number): void {
  const minKeep = Math.round(minNote * 1.25)
  for (let i = notes.length - 2; i >= 1; i--) {
    const current = notes[i]
    if (current.end - current.start >= minKeep) continue
    const prev = median(notes[i - 1].values)
    const next = median(notes[i + 1].values)
    const here = median(current.values)
    const lo = Math.min(prev, next)
    const hi = Math.max(prev, next)
    if (here > lo && here < hi) notes.splice(i, 1)
  }
}
