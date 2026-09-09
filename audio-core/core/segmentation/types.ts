/** Half-open frame range `[startFrame, endFrame)` on a timeline, with its time span in seconds. */
export interface FrameSpan {
  readonly startFrame: number
  readonly endFrame: number
  readonly startTime: number
  readonly endTime: number
  readonly duration: number
}

/** A continuous stretch of sound between pauses (one breath, one exercise step). */
export interface Phrase extends FrameSpan {
  readonly peakDb: number
  readonly meanDb: number
  /** Share of frames with a confident f0. */
  readonly voicedRatio: number
}

/**
 * How a note was entered:
 * - `attack` — from silence or an unvoiced stretch at the start of a phrase,
 * - `legato` — directly from the previous note, pitch step within a few frames,
 * - `slide` — via a portamento long enough to be its own `Slide`,
 * - `gap` — after a short unvoiced gap inside the phrase (a consonant, a breath).
 */
export type NoteTransition = 'attack' | 'legato' | 'slide' | 'gap'

export interface NoteSegment extends FrameSpan {
  /** Index of the phrase this note belongs to. */
  readonly phrase: number
  /** Median MIDI pitch over the note (fractional). */
  readonly midi: number
  /** Nearest tempered note, integer MIDI. */
  readonly note: number
  /** Median deviation from `note`, cents, in (-50, 50]. */
  readonly cents: number
  /** Median absolute deviation of the contour from its median, cents — intonation steadiness. */
  readonly spreadCents: number
  /** Frames with a confident f0 inside the segment. */
  readonly voicedFrames: number
  readonly transition: NoteTransition
}

/** A portamento between two notes (or out of a note into silence when `toNote` is undefined). */
export interface Slide extends FrameSpan {
  readonly phrase: number
  readonly fromMidi: number
  readonly toMidi: number
  /** Index of the note the slide leaves, in `TakeSegmentation.notes`. */
  readonly fromNote: number
  /** Index of the note the slide lands on, if any. */
  readonly toNote: number | undefined
}

export interface TakeSegmentation {
  readonly phrases: readonly Phrase[]
  readonly notes: readonly NoteSegment[]
  readonly slides: readonly Slide[]
  /** Level gate that separated sound from pauses, dBFS. */
  readonly gateDb: number
  /** Estimated background level, dBFS. */
  readonly noiseFloorDb: number
}
