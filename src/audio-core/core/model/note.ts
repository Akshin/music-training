/**
 * A note on the musical grid.
 *
 * The same type is played by the synthesis layer (reference melodies, metronome accents) and used
 * as the target by the scoring layer, so what the trainee hears and what they are measured against
 * cannot drift apart. Timing is in beats; a `BeatGrid` maps beats to seconds.
 */
export interface NoteEvent {
  /** MIDI pitch. Integer for tempered notes; fractional values are allowed for microtonal targets. */
  readonly midi: number
  /** Onset, in beats from the grid origin. */
  readonly startBeat: number
  /** Length in beats. */
  readonly durationBeats: number
  /** Loudness hint in [0, 1]. Defaults to 1 when absent. */
  readonly velocity?: number
}

/** Beat at which the note ends. */
export function noteEnd(note: NoteEvent): number {
  return note.startBeat + note.durationBeats
}
