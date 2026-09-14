/**
 * «Нота на долю» — call and response in two-bar cycles. The first bar plays a note on its downbeat;
 * the second bar is for singing it back from the downbeat. Notes come from the major scale of the
 * tonal centre, and the octave sung does not matter.
 */

/** Bars per cycle: one to listen, one to sing. */
export const CYCLE_BARS = 2
/** Beats the note lasts, played and sung. */
export const NOTE_BEATS = 2
/** Pitch error still counted as the note, cents. */
export const PITCH_TOLERANCE_CENTS = 50
/** Onset error still counted as on the beat, seconds. */
export const RHYTHM_TOLERANCE_SECONDS = 0.12

/** Major scale above the tonic, semitones, up to the octave. */
const MAJOR_STEPS = [0, 2, 4, 5, 7, 9, 11, 12] as const

export interface Attempt {
  readonly cycle: number
  /** The target note. */
  readonly midi: number
  /** Pitch error folded into one octave, cents; null when nothing was sung near the beat. */
  readonly cents: number | null
  /** Onset error after latency correction, seconds; positive is late, null when not sung. */
  readonly offsetSeconds: number | null
  readonly inTune: boolean
  readonly onTime: boolean
}

/** First beat of a cycle's listening bar. */
export function listenBeat(cycle: number, beatsPerBar: number): number {
  return cycle * CYCLE_BARS * beatsPerBar
}

/** First beat of a cycle's singing bar. */
export function singBeat(cycle: number, beatsPerBar: number): number {
  return (cycle * CYCLE_BARS + 1) * beatsPerBar
}

/**
 * The note of a cycle: a major-scale degree picked from `seed` and the cycle number, so a cycle
 * keeps its note however often it is asked, and a new seed gives a new sequence.
 */
export function cycleNote(tonicMidi: number, seed: number, cycle: number): number {
  const step = MAJOR_STEPS[mix(seed, cycle) % MAJOR_STEPS.length] ?? 0
  return tonicMidi + step
}

/** Cents off a target, folded into [−600, 600): singing an octave away is still the note. */
export function foldCents(cents: number): number {
  return ((((cents + 600) % 1200) + 1200) % 1200) - 600
}

export function judge(
  cycle: number,
  midi: number,
  cents: number | null,
  offsetSeconds: number | null,
): Attempt {
  const folded = cents === null ? null : foldCents(cents)
  return {
    cycle,
    midi,
    cents: folded,
    offsetSeconds,
    inTune: folded !== null && Math.abs(folded) <= PITCH_TOLERANCE_CENTS,
    onTime: offsetSeconds !== null && Math.abs(offsetSeconds) <= RHYTHM_TOLERANCE_SECONDS,
  }
}

/** A well-spread unsigned hash of two integers. */
function mix(a: number, b: number): number {
  let x = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x632be59b, 0xc2b2ae35)
  x ^= x >>> 16
  x = Math.imul(x, 0x7feb352d)
  x ^= x >>> 15
  x = Math.imul(x, 0x846ca68b)
  x ^= x >>> 16
  return x >>> 0
}
