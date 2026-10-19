/** A sung take as the ink sheet reads it: frames of pitch and loudness on the trace clock. */
export interface TakeSource {
  /** Frames so far. */
  length(): number
  frameRate(): number
  /** Trace-clock seconds of frame `index`. */
  timeOf(index: number): number
  /** Pitch (NaN where nothing is sung) and loudness (0…1) of frames `[begin, end)`. */
  read(begin: number, end: number, midi: Float32Array, level: Float32Array): void
}

/** A note of the phrase: MIDI pitch and its span in seconds. */
export interface TakeNote {
  readonly midi: number
  readonly start: number
  readonly end: number
}
