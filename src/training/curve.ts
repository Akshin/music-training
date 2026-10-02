/**
 * The pitch line of a sung piece as the architect works with it: fractional MIDI per analysis
 * frame, NaN where nothing is sung. The notes are found in the line as sung — where it holds
 * still there is a note, how it moves around a note is how the note is sung (a scoop, a fall, a
 * glide, vibrato). The line shown is then drawn back from the notes (`renderLine`), so moving,
 * levelling or retuning a note carries its stretch of the voice along; strokes drawn by hand lie
 * over it. Everything here is pure: each edit returns a new line.
 */
import { noteEdges, type Onset, type Release } from '@/training/architect'

/** How far the line may wander around a note's centre and still be that note, semitones. */
const HOLD_SEMITONES = 0.6
/** Shortest note, and how long the line must stay away from a note to start the next, seconds. */
const NOTE_SECONDS = 0.08
/** Silence a note bridges, seconds. */
const GAP_SECONDS = 0.06
/** A note's centre is the median of this much of the line before, seconds. */
const CENTRE_SECONDS = 0.3
/** A note's ends are trimmed back to where the line comes within this of its pitch, semitones. */
const TRIM_SEMITONES = 0.5
/**
 * A stretch shorter than this that moves faster than `RAMP_SEMITONES_PER_SECOND` is a way into or
 * out of a note (a scoop, a fall, a glide), not a note of its own.
 */
const RAMP_SECONDS = 0.25
const RAMP_SEMITONES_PER_SECOND = 3
/** A voiced stretch this short between two notes is a glide from one into the other, seconds. */
const GLIDE_SECONDS = 0.15

/** A note read from the line: frames `[start, end)`, its pitch and how it is sung. */
export interface CurveNote {
  readonly start: number
  readonly end: number
  /** Median pitch, fractional MIDI. */
  readonly midi: number
  readonly onset: Onset
  readonly release: Release
  readonly vibrato: boolean
}

const finite = (value: number | undefined): value is number =>
  value !== undefined && Number.isFinite(value)

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[sorted.length >> 1] ?? NaN
}

/**
 * Whether a stretch of the line wobbles like vibrato: around its median it swings 4–9 times a
 * second, at least 25 cents either way, for at least a quarter of a second.
 */
export function wobbles(values: ArrayLike<number>, frameRate: number): boolean {
  const voiced: number[] = []
  for (let i = 0; i < values.length; i++) if (finite(values[i])) voiced.push(values[i]!)
  if (voiced.length < 0.25 * frameRate) return false
  const centre = median(voiced)
  let crossings = 0
  let power = 0
  let side = 0
  for (const value of voiced) {
    const off = value - centre
    power += off * off
    if (Math.abs(off) < 0.05) continue
    const now = Math.sign(off)
    if (side !== 0 && now !== side) crossings++
    side = now
  }
  const rate = crossings / 2 / (voiced.length / frameRate)
  const extentCents = Math.sqrt(power / voiced.length) * Math.SQRT2 * 100
  return rate >= 4 && rate <= 9 && extentCents >= 25
}

/** Whether frames `[from, to)` climb or drop steadily rather than hold. */
function isRamp(values: ArrayLike<number>, from: number, to: number, frameRate: number): boolean {
  const third = Math.max(1, Math.floor((to - from) / 3))
  const mean = (start: number, end: number) => {
    let sum = 0
    let count = 0
    for (let i = start; i < end; i++) {
      if (finite(values[i])) {
        sum += values[i]!
        count++
      }
    }
    return count > 0 ? sum / count : NaN
  }
  const head = mean(from, from + third)
  const tail = mean(to - third, to)
  const seconds = (to - from - third) / frameRate || 1 / frameRate
  return Math.abs(tail - head) / seconds > RAMP_SEMITONES_PER_SECOND
}

/**
 * The notes in the line. A note holds while the line stays within `HOLD_SEMITONES` of its running
 * centre; leaving for longer than a short moment starts the next one, silence longer than a gap
 * ends it, and so does a cut (frame indices where one note ends and the next begins, for repeated
 * notes of one pitch). Each note is then trimmed to where the line is at its pitch, and read for
 * how it is entered and left.
 */
export function curveNotes(
  values: ArrayLike<number>,
  frameRate: number,
  cuts: Iterable<number> = [],
): CurveNote[] {
  const shortest = Math.max(1, Math.ceil(NOTE_SECONDS * frameRate))
  const gap = Math.max(1, Math.ceil(GAP_SECONDS * frameRate))
  const window = Math.max(1, Math.round(CENTRE_SECONDS * frameRate))
  const cutAt = new Set(cuts)
  const spans: { start: number; end: number }[] = []
  let current: { start: number; end: number; values: number[] } | null = null
  let away: number[] = []
  let silent = 0
  const close = () => {
    if (current !== null && current.values.length >= shortest) {
      spans.push({ start: current.start, end: current.end + 1 })
    }
    current = null
    away = []
  }
  for (let i = 0; i < values.length; i++) {
    if (cutAt.has(i)) close()
    const value = values[i]
    if (!finite(value)) {
      if (current !== null && ++silent > gap) close()
      continue
    }
    silent = 0
    if (current === null) {
      current = { start: i, end: i, values: [value] }
      continue
    }
    const centre = median(current.values.slice(-window))
    if (Math.abs(value - centre) > HOLD_SEMITONES) {
      away.push(i)
      if (away.length >= shortest) {
        const first = away[0]!
        const moved = away.map((index) => values[index]!)
        close()
        current = { start: first, end: i, values: moved }
      }
    } else {
      away = []
      current.values.push(value)
      current.end = i
    }
  }
  close()

  // Each note trimmed to where the line is at its pitch; what is left around it is its entry and
  // exit, or a glide between notes.
  const notes = spans.flatMap(({ start, end }) => {
    const pitches: number[] = []
    for (let i = start; i < end; i++) if (finite(values[i])) pitches.push(values[i]!)
    const pitch = median(pitches)
    let from = start
    let to = end
    while (from < to && !(Math.abs((values[from] ?? NaN) - pitch) <= TRIM_SEMITONES)) from++
    while (to > from && !(Math.abs((values[to - 1] ?? NaN) - pitch) <= TRIM_SEMITONES)) to--
    if (to - from < shortest) return []
    if (to - from < RAMP_SECONDS * frameRate && isRamp(values, from, to, frameRate)) return []
    return [{ start: from, end: to, midi: pitch }]
  })

  const glideFrames = Math.ceil(GLIDE_SECONDS * frameRate)
  const voicedBetween = (from: number, to: number) => {
    for (let i = from; i < to; i++) if (!finite(values[i])) return false
    return true
  }
  return notes.map((note, index) => {
    const next = notes[index + 1]
    const previous = notes[index - 1]
    const glides =
      next !== undefined &&
      next.start - note.end <= glideFrames &&
      !cutAt.has(next.start) &&
      Math.round(next.midi) !== Math.round(note.midi) &&
      voicedBetween(note.end, next.start)
    const glidedInto =
      previous !== undefined &&
      note.start - previous.end <= glideFrames &&
      Math.round(previous.midi) !== Math.round(note.midi) &&
      voicedBetween(previous.end, note.start)
    const edges = noteEdges(values, note.start, note.end, note.midi, frameRate)
    const slice: number[] = []
    for (let i = note.start; i < note.end; i++) slice.push(values[i] ?? NaN)
    const onset: Onset = edges.scoop && !glidedInto ? 'scoop' : 'plain'
    const release: Release = glides ? 'glide' : edges.fall ? 'fall' : 'plain'
    return { ...note, onset, release, vibrato: wobbles(slice, frameRate) }
  })
}

// ---- Edits ----

/**
 * The line around `centre` moved by `semitones`, fading out over `radius` frames either way (a
 * Gaussian), so the moved stretch stays joined to the rest. Silence stays silent.
 */
export function bend(
  base: Float32Array,
  centre: number,
  radius: number,
  semitones: number,
): Float32Array {
  const next = base.slice()
  const spread = Math.max(1, radius / 2)
  const reach = Math.ceil(radius * 1.5)
  for (let i = Math.max(0, centre - reach); i < Math.min(next.length, centre + reach); i++) {
    if (!finite(next[i])) continue
    next[i] = next[i]! + semitones * Math.exp(-((i - centre) ** 2) / (2 * spread * spread))
  }
  return next
}

/** A straight stroke of the pen from one point to another, drawn into the line (silence included). */
export function stroke(
  values: Float32Array,
  from: number,
  fromPitch: number,
  to: number,
  toPitch: number,
): Float32Array {
  const next = values.slice()
  const low = Math.max(0, Math.min(from, to))
  const high = Math.min(next.length - 1, Math.max(from, to))
  for (let i = low; i <= high; i++) {
    const t = to === from ? 1 : (i - from) / (to - from)
    next[i] = fromPitch + (toPitch - fromPitch) * Math.min(1, Math.max(0, t))
  }
  return next
}

/** A glide from one point to another, eased so it leaves and lands level. */
export function glide(
  values: Float32Array,
  from: number,
  fromPitch: number,
  to: number,
  toPitch: number,
): Float32Array {
  const next = values.slice()
  const low = Math.max(0, Math.min(from, to))
  const high = Math.min(next.length - 1, Math.max(from, to))
  for (let i = low; i <= high; i++) {
    const t = to === from ? 1 : Math.min(1, Math.max(0, (i - from) / (to - from)))
    next[i] = fromPitch + (toPitch - fromPitch) * t * t * (3 - 2 * t)
  }
  return next
}

// ---- The line drawn from the notes ----

/** Seconds a note's slow drift is averaged over: longer than a cycle of vibrato. */
const SLOW_SECONDS = 0.2
/** A loose piece this close to a note that climbs or drops into it is its way in or out, seconds. */
const LOOSE_GAP_SECONDS = 0.03
/** Shortest loose piece of the line shown, seconds. */
const LOOSE_SECONDS = 0.04

/** A note as the line is drawn from it, in frames of the line. */
export interface RenderNote {
  /** Frames it takes, `[from, to)`. */
  readonly from: number
  readonly to: number
  /** Where it goes, MIDI. */
  readonly pitch: number
  /** Frames it was sung in and its centre there; null for a note drawn by hand. */
  readonly source: { readonly from: number; readonly to: number; readonly centre: number } | null
  /** 0 keeps its drift as sung, 1 holds it level. */
  readonly flatness: number
  /** Its vibrato: 0 none, 1 as sung. */
  readonly vibratoScale: number
}

/** `values` at fractional frame `at`: between two voiced frames the line between them. */
function sample(values: ArrayLike<number>, at: number): number {
  const below = Math.floor(at)
  const a = values[below]
  const b = values[below + 1]
  if (!finite(a)) return finite(b) && at - below > 0.5 ? b : NaN
  if (!finite(b)) return a
  return a + (b - a) * (at - below)
}

/**
 * The line of the piece as its notes make it. Each note takes the stretch of the voice it was sung
 * in, laid over the frames it now takes and moved to its pitch: its slow drift kept by
 * `1 − flatness`, its vibrato scaled by `vibratoScale`. Between notes the voice goes as sung —
 * scoops, glides and falls — following the notes on either side. A note drawn by hand is level.
 * Frames drawn by hand (`overrides`, NaN where none) are taken as they are.
 */
export function renderLine(
  sung: ArrayLike<number>,
  notes: readonly RenderNote[],
  overrides: ArrayLike<number> | null,
  frameRate: number,
): Float32Array {
  const length = sung.length
  const out = new Float32Array(length).fill(NaN)
  const ordered = [...notes].sort((a, b) => a.from - b.from)
  const shift = (note: RenderNote) => (note.source === null ? 0 : note.pitch - note.source.centre)

  // Prefix sums of the voiced frames, for the slow part of a note's line.
  const sums = new Float64Array(length + 1)
  const counts = new Int32Array(length + 1)
  for (let i = 0; i < length; i++) {
    const value = sung[i]
    sums[i + 1] = sums[i]! + (finite(value) ? value : 0)
    counts[i + 1] = counts[i]! + (finite(value) ? 1 : 0)
  }
  const half = Math.max(1, Math.round((SLOW_SECONDS * frameRate) / 2))
  const slowAt = (at: number, low: number, high: number) => {
    const a = Math.max(low, Math.round(at) - half)
    const b = Math.min(high, Math.round(at) + half + 1)
    const count = b > a ? counts[b]! - counts[a]! : 0
    return count > 0 ? (sums[b]! - sums[a]!) / count : NaN
  }

  // The voice as sung, moved by `offset(j)`, over frames `[from, to)` read from `source(j)`.
  const follow = (
    from: number,
    to: number,
    source: (j: number) => number,
    offset: (j: number) => number,
  ) => {
    for (let j = Math.max(0, from); j < Math.min(length, to); j++) {
      const value = sample(sung, source(j))
      if (finite(value)) out[j] = value + offset(j)
    }
  }

  const first = ordered[0]
  const last = ordered.at(-1)
  if (first === undefined || last === undefined) {
    follow(
      0,
      length,
      (j) => j,
      () => 0,
    )
  } else {
    // Before the first note and after the last, the voice keeps pace with them.
    const lead = first.source === null ? 0 : first.source.from - first.from
    follow(
      0,
      first.from,
      (j) => j + lead,
      () => shift(first),
    )
    const tail = last.source === null ? 0 : last.source.to - last.to
    follow(
      last.to,
      length,
      (j) => j + tail,
      () => shift(last),
    )
  }

  ordered.forEach((note, index) => {
    const next = ordered[index + 1]
    if (next !== undefined && next.from > note.to) {
      // The way from one note into the next, stretched to the room between them.
      const room = next.from - note.to
      const a = note.source?.to ?? note.to
      const b = next.source?.from ?? next.from
      follow(
        note.to,
        next.from,
        (j) => a + ((j - note.to) / room) * (b - a),
        (j) => shift(note) + ((j - note.to) / room) * (shift(next) - shift(note)),
      )
    }
    const { source } = note
    const span = Math.max(1, note.to - note.from)
    for (let j = Math.max(0, note.from); j < Math.min(length, note.to); j++) {
      if (source === null) {
        out[j] = note.pitch
        continue
      }
      const at = source.from + ((j - note.from) / span) * (source.to - source.from)
      const value = sample(sung, at)
      if (!finite(value)) continue
      const slow = slowAt(at, source.from, source.to)
      const drift = (finite(slow) ? slow : value) - source.centre
      const wobble = finite(slow) ? value - slow : 0
      out[j] = note.pitch + (1 - note.flatness) * drift + note.vibratoScale * wobble
    }
  })

  if (overrides !== null) {
    for (let j = 0; j < Math.min(length, overrides.length); j++) {
      if (finite(overrides[j])) out[j] = overrides[j]!
    }
  }
  return out
}

/** A stretch of the voice that is no note: frames `[start, end)` and its pitch. */
export interface LoosePiece {
  readonly start: number
  readonly end: number
  readonly midi: number
}

/**
 * The sung stretches no note covers — a short note the finder let go, a note sung too unsteadily
 * — but not the ways into and out of notes: a piece right next to a note that climbs or drops is
 * how that note is entered or left.
 */
export function loosePieces(
  values: ArrayLike<number>,
  notes: readonly { readonly start: number; readonly end: number }[],
  frameRate: number,
): LoosePiece[] {
  const covered = new Uint8Array(values.length)
  for (const note of notes) {
    covered.fill(1, Math.max(0, note.start), Math.min(values.length, note.end))
  }
  const shortest = Math.max(2, Math.round(LOOSE_SECONDS * frameRate))
  const near = Math.max(1, Math.round(LOOSE_GAP_SECONDS * frameRate))
  const touches = (from: number, to: number) =>
    notes.some((note) => Math.abs(note.start - to) <= near || Math.abs(from - note.end) <= near)
  const pieces: LoosePiece[] = []
  let start = -1
  for (let i = 0; i <= values.length; i++) {
    const free = i < values.length && covered[i] === 0 && finite(values[i])
    if (free && start < 0) start = i
    if (free || start < 0) continue
    const end = i
    if (
      end - start >= shortest &&
      !(touches(start, end) && isRamp(values, start, end, frameRate))
    ) {
      const voiced: number[] = []
      for (let j = start; j < end; j++) voiced.push(values[j]!)
      pieces.push({ start, end, midi: median(voiced) })
    }
    start = -1
  }
  return pieces
}
