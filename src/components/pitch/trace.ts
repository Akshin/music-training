/** A window of recent analysis frames for pitch charts, oldest first. */
export interface PitchTrace {
  /** Fractional MIDI pitch per frame; NaN where nothing is sung. */
  readonly midi: ArrayLike<number>
  /** Loudness per frame in [0, 1]. */
  readonly level: ArrayLike<number>
  /** Frames in use, counted from the start of the arrays. */
  readonly length: number
  /** Frames per second. */
  readonly frameRate: number
  /** Time of the newest frame, seconds on the trace clock that `PitchTarget` uses too. */
  readonly endTime: number
}

/** A note to sing, placed on the same clock as the trace frames. */
export interface PitchTarget {
  readonly midi: number
  /** Start and end, seconds on the trace clock. */
  readonly start: number
  readonly end: number
  /** Drawn stronger: a note to sing rather than one to listen to. */
  readonly strong?: boolean
}

export const EMPTY_PITCH_TRACE: PitchTrace = {
  midi: [],
  level: [],
  length: 0,
  frameRate: 100,
  endTime: 0,
}
