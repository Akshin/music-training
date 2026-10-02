/**
 * Notes as the architect's editor holds them: in beats from the take's first downbeat, so they
 * keep their place in the music when the tempo changes. Pure operations; the editor composable
 * adds selection and undo on top.
 */
import type { Grid, NoteSource, Onset, Release, ShapedNote } from '@/training/architect'

export interface EditNote {
  readonly id: number
  /** Whole semitone, MIDI. */
  readonly midi: number
  /** Beats from beat 0 of the grid; negative inside the count-in. */
  readonly start: number
  /** Beats. */
  readonly length: number
  /** How the note is entered and left, and whether it is sung with vibrato. */
  readonly onset: Onset
  readonly release: Release
  readonly vibrato: boolean
  /** Where it was sung; none for a note drawn by hand. */
  readonly source?: NoteSource
  /** How level its line is: 0 as sung (default), 1 held on its pitch. */
  readonly flatness?: number
  /** Its vibrato: 0 none, 1 as sung (default), up to `VIBRATO_MAX`. */
  readonly vibratoScale?: number
}

/** How far a note's vibrato may be widened. */
export const VIBRATO_MAX = 1.5

/** A note's line: how level it is and how much vibrato it keeps. */
export interface LineShape {
  readonly flatness: number
  readonly vibratoScale: number
}

/** The line a note is sung with, defaults filled in. */
export const shapeOf = (note: EditNote): LineShape => ({
  flatness: note.flatness ?? 0,
  vibratoScale: note.vibratoScale ?? 1,
})

/** Level and without vibrato: the note as an exercise would have it. */
export const isLevel = (note: EditNote): boolean => {
  const shape = shapeOf(note)
  return shape.flatness >= 1 && shape.vibratoScale <= 0
}

/** Shortest note the editor makes, beats: a thirty-second in 4/4. */
export const MIN_LENGTH = 0.125
/** Notes the editor allows: C1…C8. */
export const MIDI_LOW = 24
export const MIDI_HIGH = 108

/** Grid steps in beats; 0 moves freely. */
export const SNAP_STEPS = [1, 1 / 2, 1 / 3, 1 / 4, 0] as const

/** A beat position on the grid of `step` beats; unchanged when the step is 0 (free). */
export function snapBeat(beat: number, step: number): number {
  if (step <= 0) return beat
  return Math.round(beat / step) * step
}

/** Notes in seconds on the take's clock as notes in beats of `grid`. */
export function toBeats(notes: readonly ShapedNote[], grid: Grid, firstId = 1): EditNote[] {
  return notes.map((note, index) => ({
    id: firstId + index,
    midi: Math.round(note.midi),
    start: (note.start - grid.origin) / grid.beatSeconds,
    length: Math.max(MIN_LENGTH, (note.end - note.start) / grid.beatSeconds),
    onset: note.onset ?? 'plain',
    release: note.release ?? (note.slide ? 'glide' : 'plain'),
    vibrato: note.vibrato === true,
    ...(note.source === undefined ? {} : { source: note.source }),
  }))
}

/** Notes in beats as notes in seconds on the take's clock, in order of time. */
export function toSeconds(notes: readonly EditNote[], grid: Grid): ShapedNote[] {
  return [...notes]
    .sort((a, b) => a.start - b.start)
    .map((note) => ({
      midi: note.midi,
      start: grid.origin + note.start * grid.beatSeconds,
      end: grid.origin + (note.start + note.length) * grid.beatSeconds,
      slide: note.release === 'glide',
      onset: note.onset,
      release: note.release,
      vibrato: note.vibrato,
      ...(note.source === undefined ? {} : { source: note.source }),
    }))
}

const clampMidi = (midi: number) => Math.min(MIDI_HIGH, Math.max(MIDI_LOW, Math.round(midi)))

/** The chosen notes moved by beats and semitones; the others as they are. */
export function moveNotes(
  notes: readonly EditNote[],
  ids: ReadonlySet<number>,
  beats: number,
  semitones: number,
): EditNote[] {
  return notes.map((note) =>
    ids.has(note.id)
      ? { ...note, start: note.start + beats, midi: clampMidi(note.midi + semitones) }
      : note,
  )
}

/**
 * One note's edge dragged to `beat`: its end (the start stays) or its start (the end stays). A note
 * never gets shorter than `MIN_LENGTH`.
 */
export function resizeNote(
  notes: readonly EditNote[],
  id: number,
  edge: 'start' | 'end',
  beat: number,
): EditNote[] {
  return notes.map((note) => {
    if (note.id !== id) return note
    const end = note.start + note.length
    if (edge === 'end') return { ...note, length: Math.max(MIN_LENGTH, beat - note.start) }
    const start = Math.min(beat, end - MIN_LENGTH)
    return { ...note, start, length: end - start }
  })
}

/** Notes in order of time, lengths and pitches within the editor's limits. */
export function tidy(notes: readonly EditNote[]): EditNote[] {
  return [...notes]
    .map((note) => ({
      ...note,
      midi: clampMidi(note.midi),
      length: Math.max(MIN_LENGTH, note.length),
    }))
    .sort((a, b) => a.start - b.start || a.midi - b.midi)
}

/** The chosen notes given another entry, exit or vibrato. */
export function markNotes(
  notes: readonly EditNote[],
  ids: ReadonlySet<number>,
  mark: Partial<Pick<EditNote, 'onset' | 'release' | 'vibrato'>>,
): EditNote[] {
  return notes.map((note) => (ids.has(note.id) ? { ...note, ...mark } : note))
}

/** Copies of `notes` starting at `at` beats (their first one lands there), with ids from `firstId`. */
export function placeCopies(notes: readonly EditNote[], at: number, firstId: number): EditNote[] {
  if (notes.length === 0) return []
  const first = Math.min(...notes.map((note) => note.start))
  return notes.map((note, index) => ({
    ...note,
    id: firstId + index,
    start: at + note.start - first,
  }))
}

/** Where copies of the chosen notes go when duplicated: right after them, on the grid. */
export function afterNotes(notes: readonly EditNote[], step: number): number {
  const end = Math.max(...notes.map((note) => note.start + note.length))
  if (step <= 0) return end
  return Math.ceil(end / step - 1e-9) * step
}

/**
 * The chosen notes cut at `beat`: each note the beat falls inside becomes two, the second a new
 * note with id from `nextId`. A cut leaves both halves at least `MIN_LENGTH` long.
 */
export function splitNotes(
  notes: readonly EditNote[],
  ids: ReadonlySet<number>,
  beat: number,
  nextId: number,
): EditNote[] {
  let id = nextId
  return notes.flatMap((note) => {
    const end = note.start + note.length
    if (!ids.has(note.id) || beat < note.start + MIN_LENGTH || beat > end - MIN_LENGTH)
      return [note]
    // Each half keeps its share of where it was sung.
    const { source } = note
    const cut =
      source && source.start + ((beat - note.start) / note.length) * (source.end - source.start)
    return [
      {
        ...note,
        length: beat - note.start,
        release: 'plain' as const,
        ...(source && cut !== undefined ? { source: { ...source, end: cut } } : {}),
      },
      {
        ...note,
        id: id++,
        start: beat,
        length: end - beat,
        onset: 'plain' as const,
        ...(source && cut !== undefined ? { source: { ...source, start: cut } } : {}),
      },
    ]
  })
}

/**
 * The chosen notes joined into one: from the first one's start to the last one's end, at the first
 * one's pitch, entered like the first and left like the last. Nothing changes with fewer than two.
 */
export function joinNotes(notes: readonly EditNote[], ids: ReadonlySet<number>): EditNote[] {
  const chosen = notes.filter((note) => ids.has(note.id)).sort((a, b) => a.start - b.start)
  if (chosen.length < 2) return [...notes]
  const first = chosen[0]!
  const last = chosen.reduce((latest, note) =>
    note.start + note.length > latest.start + latest.length ? note : latest,
  )
  const joined: EditNote = {
    ...first,
    length: last.start + last.length - first.start,
    release: last.release,
    vibrato: chosen.some((note) => note.vibrato),
    ...(first.source && last.source
      ? { source: { ...first.source, end: Math.max(first.source.end, last.source.end) } }
      : {}),
  }
  return [...notes.filter((note) => !ids.has(note.id)), joined]
}
