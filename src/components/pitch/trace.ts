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

/** Stay on the pitch: full width. */
export interface PitchHoldSegment {
  readonly kind: 'hold'
  readonly duration: number
}

/** A fast attack on the pitch: grows from a point to full width, a triangle pointing left. */
export interface PitchStaccatoSegment {
  readonly kind: 'staccato'
  readonly duration: number
}

/** Glide from the pitch to `to`, eased so it leaves and lands flat. */
export interface PitchSlideSegment {
  readonly kind: 'slide'
  readonly to: number
  readonly duration: number
}

/** One part of a note, seconds long. */
export type PitchSegment = PitchHoldSegment | PitchStaccatoSegment | PitchSlideSegment

/**
 * A note on the chart, placed on the same clock as the trace frames: its segments follow one
 * another from `start`, each picking up the pitch where the previous one left it. So a staccato,
 * a slide and a hold make one note that attacks, glides and stays.
 */
export interface PitchTarget {
  /** Pitch the note starts on, MIDI. */
  readonly midi: number
  /** Seconds on the trace clock. */
  readonly start: number
  readonly segments: readonly PitchSegment[]
}

/** A segment placed in time, with the pitch it starts and ends on. */
export interface PlacedPitchSegment {
  readonly segment: PitchSegment
  readonly start: number
  readonly end: number
  readonly from: number
  readonly to: number
}

/** A plain held note, the most common target. */
export function heldNote(midi: number, start: number, end: number): PitchTarget {
  return { midi, start, segments: [{ kind: 'hold', duration: Math.max(0, end - start) }] }
}

/** Slide easing over [0, 1]: smoothstep, flat at both ends. */
export function slideEase(t: number): number {
  const u = Math.min(1, Math.max(0, t))
  return u * u * (3 - 2 * u)
}

/** The note's segments laid out in time, each with its start and end pitch. */
export function placeSegments(target: PitchTarget): PlacedPitchSegment[] {
  const placed: PlacedPitchSegment[] = []
  let time = target.start
  let pitch = target.midi
  for (const segment of target.segments) {
    const duration = Math.max(0, segment.duration)
    const to = segment.kind === 'slide' ? segment.to : pitch
    placed.push({ segment, start: time, end: time + duration, from: pitch, to })
    time += duration
    pitch = to
  }
  return placed
}

/** When the note ends, seconds on the trace clock. */
export function targetEnd(target: PitchTarget): number {
  return target.segments.reduce((end, segment) => end + Math.max(0, segment.duration), target.start)
}

/** The pitch the note asks for at `time`, fractional MIDI; null outside the note. */
export function targetPitchAt(target: PitchTarget, time: number): number | null {
  for (const part of placeSegments(target)) {
    if (time < part.start || time > part.end) continue
    if (part.segment.kind !== 'slide') return part.from
    const t = part.end > part.start ? (time - part.start) / (part.end - part.start) : 1
    return part.from + (part.to - part.from) * slideEase(t)
  }
  return null
}

export const EMPTY_PITCH_TRACE: PitchTrace = {
  midi: [],
  level: [],
  length: 0,
  frameRate: 100,
  endTime: 0,
}
