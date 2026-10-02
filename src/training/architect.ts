/**
 * The architect turns a sung take into an exercise. The notes found in the voice are pulled towards
 * the beat grid by a strength (0 keeps the timing as sung, 1 puts every note on the grid, as the
 * quantize amount on Ableton Move), optionally onto the notes of a key, moved by semitones and
 * retimed to another tempo; then they are laid out as builder bars to sing into.
 *
 * Times are seconds on the take's clock; the grid is the metronome's while the take was recorded,
 * or one that starts on the first note when it was sung freely.
 */
import {
  EMPTY_DRAFT,
  MAX_SIXTEENTHS,
  barCapacity,
  sixteenthsPerBeat,
  type BarElement,
  type BuilderBar,
  type PulseLayer,
  type TrainingDraft,
} from '@/training/builder'
import { BPM_MAX, BPM_MIN } from '@/training/tempo'

/** How a note is entered: straight on the pitch, scooped up from below, or struck hard. */
export type Onset = 'plain' | 'scoop' | 'attack'
/** How a note is left: straight, gliding into the next note, or falling off. */
export type Release = 'plain' | 'glide' | 'fall'

/** A note found in the voice: fractional MIDI, seconds, and how it was sung. */
export interface SungNote {
  readonly midi: number
  readonly start: number
  readonly end: number
  /** Glides into the next note. */
  readonly slide: boolean
  readonly scoop?: boolean
  readonly fall?: boolean
  readonly vibrato?: boolean
}

/** Where a note was sung: seconds on the take's clock, its centre (fractional MIDI), which one. */
export interface NoteSource {
  readonly start: number
  readonly end: number
  readonly midi: number
  /** Its place among the notes found in the take. */
  readonly index: number
}

/** A note of the exercise: a whole semitone, seconds on the take's clock. */
export interface ShapedNote {
  readonly midi: number
  readonly start: number
  readonly end: number
  /** Glides into the next note; the same as `release: 'glide'`. */
  readonly slide: boolean
  readonly onset?: Onset
  readonly release?: Release
  readonly vibrato?: boolean
  /** The sung note it was made from; none for a note drawn by hand. */
  readonly source?: NoteSource
}

/** A key: tonic pitch class (C = 0) and mode. */
export interface Key {
  readonly tonic: number
  readonly minor: boolean
}

/** Beats on the take's clock. */
export interface Grid {
  /** Seconds of beat 0. */
  readonly origin: number
  readonly beatSeconds: number
}

export const MAJOR_SCALE = [0, 2, 4, 5, 7, 9, 11] as const
export const MINOR_SCALE = [0, 2, 3, 5, 7, 8, 10] as const

/** Krumhansl–Kessler key profiles: how well each degree of the key fits it. */
const PROFILES = {
  major: [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88],
  minor: [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17],
} as const

/** Shortest note kept once quantized, seconds. */
const MIN_NOTE_SECONDS = 0.05

const pitchClass = (midi: number) => ((Math.round(midi) % 12) + 12) % 12

/**
 * The key that fits the notes best: each pitch class weighted by how long it was sung, correlated
 * with the 24 rotated profiles. C major when there is nothing to go by.
 */
export function detectKey(notes: readonly SungNote[]): Key {
  const weights = Array.from({ length: 12 }, () => 0)
  for (const note of notes) weights[pitchClass(note.midi)]! += Math.max(0, note.end - note.start)
  const mean = (values: readonly number[]) => values.reduce((sum, value) => sum + value, 0) / 12
  const weightMean = mean(weights)
  let best: Key = { tonic: 0, minor: false }
  let bestScore = -Infinity
  for (const minor of [false, true]) {
    const profile = minor ? PROFILES.minor : PROFILES.major
    const profileMean = mean(profile)
    for (let tonic = 0; tonic < 12; tonic++) {
      let product = 0
      let weightSquares = 0
      let profileSquares = 0
      for (let degree = 0; degree < 12; degree++) {
        const weight = weights[(tonic + degree) % 12]! - weightMean
        const fit = profile[degree]! - profileMean
        product += weight * fit
        weightSquares += weight * weight
        profileSquares += fit * fit
      }
      const score = weightSquares > 0 ? product / Math.sqrt(weightSquares * profileSquares) : -1
      if (score > bestScore) {
        bestScore = score
        best = { tonic, minor }
      }
    }
  }
  return best
}

/** The nearest note of the key, or the nearest semitone without one. */
export function snapToKey(midi: number, key: Key | null): number {
  if (key === null) return Math.round(midi)
  const scale: readonly number[] = key.minor ? MINOR_SCALE : MAJOR_SCALE
  let best = Math.round(midi)
  let distance = Infinity
  for (let candidate = Math.floor(midi) - 2; candidate <= Math.ceil(midi) + 2; candidate++) {
    const degree = (((candidate - key.tonic) % 12) + 12) % 12
    if (!scale.includes(degree)) continue
    if (Math.abs(candidate - midi) < distance) {
      distance = Math.abs(candidate - midi)
      best = candidate
    }
  }
  return best
}

export interface Shaping {
  /** Notes of this key only; null rounds to the nearest semitone. */
  readonly key: Key | null
  /** How far notes move towards the grid, 0…1. */
  readonly strength: number
  /** Grid lines per beat: 1 quarters, 2 eighths, 4 sixteenths (in 4/4). */
  readonly perBeat: number
  readonly grid: Grid
  /** Semitones up (positive) or down. */
  readonly transpose: number
  /** New tempo over the recorded one: 2 plays twice as fast. */
  readonly tempo: number
}

/** The sung notes shaped into an exercise, in order, without overlaps. */
export function shapeNotes(notes: readonly SungNote[], shaping: Shaping): ShapedNote[] {
  const { key, grid, transpose } = shaping
  const strength = Math.min(1, Math.max(0, shaping.strength))
  const spacing = grid.beatSeconds / Math.max(1, shaping.perBeat)

  // Notes are taken as they are: repeated notes of one pitch are meant apart (they were cut so).
  const joined = notes
    .map((note, index) => ({ note, index }))
    .sort((a, b) => a.note.start - b.note.start)
    .map(({ note, index }) => ({
      source: { start: note.start, end: note.end, midi: note.midi, index },
      midi: snapToKey(note.midi, key),
      start: note.start,
      end: note.end,
      slide: note.slide,
      onset: (note.scoop === true ? 'scoop' : 'plain') as Onset,
      fall: note.fall === true,
      vibrato: note.vibrato === true,
    }))

  const pull = (time: number) => {
    const nearest = grid.origin + Math.round((time - grid.origin) / spacing) * spacing
    return time + (nearest - time) * strength
  }
  // A fully quantized note is at least one grid step long; a free one keeps what was sung.
  const shortest = MIN_NOTE_SECONDS + strength * (spacing - MIN_NOTE_SECONDS)
  const placed = joined.map((note) => {
    const start = pull(note.start)
    return { ...note, start, end: Math.max(pull(note.end), start + shortest) }
  })
  for (let i = 0; i + 1 < placed.length; i++) {
    placed[i]!.end = Math.min(placed[i]!.end, placed[i + 1]!.start)
  }

  const stretch = 1 / Math.max(0.01, shaping.tempo)
  const at = (time: number) => grid.origin + (time - grid.origin) * stretch
  return placed
    .filter((note) => note.end - note.start > 0.02)
    .map((note) => ({
      midi: note.midi + transpose,
      start: at(note.start),
      end: at(note.end),
      slide: note.slide,
      onset: note.onset,
      release: note.slide ? ('glide' as const) : note.fall ? ('fall' as const) : ('plain' as const),
      vibrato: note.vibrato,
      source: note.source,
    }))
}

/** Tempos an exercise made at `bpm` may be sung at: half as fast to half as fast again. */
export function tempoRange(bpm: number): { min: number; max: number } {
  return {
    min: Math.max(BPM_MIN, Math.round(bpm * 0.5)),
    max: Math.min(BPM_MAX, Math.round(bpm * 1.5)),
  }
}

/** The longest gap a glide bridges when laid out as bars, sixteenths: a beat in 4/4. */
const GLIDE_GAP_SIXTEENTHS = 4

export interface Layout {
  /** The grid the notes are timed against, at the exercise's tempo. */
  readonly grid: Grid
  readonly bpm: number
  readonly beats: number
  readonly title: string
  /** The metronome's second layer the exercise is sung against; none leaves it out. */
  readonly pulse?: PulseLayer | null
}

/**
 * The notes as a training draft: sixteenths from the grid, bars from the first one with a note,
 * rests in the gaps, every bar full. A note keeps its length as sung on the grid: one that runs
 * over a bar line (or is longer than a whole note) is written as parts tied together, entered
 * like the note and left like it — an attack on its first part, a slide on its last.
 */
export function toDraft(notes: readonly ShapedNote[], layout: Layout): TrainingDraft {
  const { grid, beats } = layout
  const capacity = barCapacity(beats)
  const sixteenth = grid.beatSeconds / sixteenthsPerBeat(beats)
  const onGrid = (time: number) => Math.round((time - grid.origin) / sixteenth)

  const placed: { midi: number; start: number; end: number; slide: boolean; attack: boolean }[] = []
  for (const note of [...notes].sort((a, b) => a.start - b.start)) {
    const previous = placed.at(-1)
    const start = Math.max(onGrid(note.start), previous?.end ?? -Infinity)
    const end = Math.max(onGrid(note.end), start + 1)
    placed.push({ midi: note.midi, start, end, slide: note.slide, attack: note.onset === 'attack' })
  }
  // A glide runs through the gap to the next note, so the note reaches it and slides into it.
  for (let i = 0; i + 1 < placed.length; i++) {
    const note = placed[i]!
    const next = placed[i + 1]!
    if (note.slide && next.start > note.end && next.start - note.end <= GLIDE_GAP_SIXTEENTHS) {
      note.end = next.start
    }
  }
  const bars: BuilderBar[] = []
  if (placed.length > 0) {
    const shift = Math.floor(placed[0]!.start / capacity) * capacity
    const elements: BarElement[] = []
    let position = 0
    /** `[from, to)` cut at every bar line and into lengths no longer than a whole note. */
    const parts = (from: number, to: number) => {
      const lengths: number[] = []
      for (let at = from; at < to;) {
        const length = Math.min(to - at, capacity - (at % capacity), MAX_SIXTEENTHS)
        lengths.push(length)
        at += length
      }
      return lengths
    }
    const rests = (to: number) => {
      for (const length of parts(position, to)) elements.push({ type: 'rest', sixteenths: length })
      position = Math.max(position, to)
    }
    placed.forEach((note, index) => {
      const start = note.start - shift
      const end = note.end - shift
      rests(start)
      const glides = note.slide && placed[index + 1] !== undefined
      const lengths = parts(start, end)
      lengths.forEach((length, part) => {
        const last = part === lengths.length - 1
        elements.push({
          type: 'note',
          midi: note.midi,
          kind: last && glides ? 'slide' : part === 0 && note.attack ? 'attack' : 'hold',
          sixteenths: length,
          ...(part > 0 ? { tie: true } : {}),
        })
      })
      position = end
    })
    rests(Math.ceil(position / capacity) * capacity)
    let fill = 0
    let bar: BarElement[] = []
    for (const element of elements) {
      bar.push(element)
      fill += element.sixteenths
      if (fill === capacity) {
        bars.push({ id: bars.length + 1, elements: bar })
        bar = []
        fill = 0
      }
    }
  }
  return {
    ...EMPTY_DRAFT,
    title: layout.title,
    beats,
    bpmRange: tempoRange(layout.bpm),
    bars,
    current: [],
    pulse: layout.pulse ?? null,
  }
}

/** Seconds on the take's clock where the draft `toDraft` makes of these notes begins: its first bar. */
export function draftStart(notes: readonly ShapedNote[], layout: Layout): number | null {
  const { grid, beats } = layout
  if (notes.length === 0) return null
  const sixteenth = grid.beatSeconds / sixteenthsPerBeat(beats)
  const first = Math.min(...notes.map((note) => Math.round((note.start - grid.origin) / sixteenth)))
  const capacity = barCapacity(beats)
  return grid.origin + Math.floor(first / capacity) * capacity * sixteenth
}

/** How far from the metronome's tempo a take may really have been sung, as a share of it. */
const TEMPO_FIT_RANGE = 0.3

/**
 * The tempo a take was really sung at, near the one the metronome gave: the candidate (in half
 * BPM steps, within ±30%) that puts the notes' starts closest to its eighths, counted from the
 * downbeat the take is bound to. A slight pull towards the metronome's tempo settles near-ties.
 */
export function fitTempo(onsets: readonly number[], origin: number, bpm: number): number {
  if (onsets.length < 2) return bpm
  let best = bpm
  let bestScore = -Infinity
  const low = Math.ceil(bpm * (1 - TEMPO_FIT_RANGE) * 2) / 2
  const high = bpm * (1 + TEMPO_FIT_RANGE)
  for (let candidate = low; candidate <= high; candidate += 0.5) {
    const eighth = 30 / candidate
    let score = 0
    for (const onset of onsets) score += Math.cos((2 * Math.PI * (onset - origin)) / eighth)
    score -= (Math.abs(candidate - bpm) / bpm) * 0.2 * onsets.length
    if (score > bestScore) {
      bestScore = score
      best = candidate
    }
  }
  return best
}

/** A dip this far below a note's typical loudness is a consonant between two notes, dB. */
const DIP_DB = 12
/** A dip must last this long to split a note, seconds. */
const DIP_SECONDS = 0.03
/** Pieces shorter than this after a split are dropped, seconds. */
const PIECE_SECONDS = 0.06

/**
 * One found note split where the voice dips: repeated notes of the same pitch ("mi-mi-mi") hold
 * one pitch throughout, so only the loudness shows where one ends and the next begins. Takes the
 * note's frames (`dbfs`, `midi`, fractional MIDI or NaN) and returns its pieces as frame ranges
 * `[start, end)` with their median pitch.
 */
export function splitAtDips(
  dbfs: ArrayLike<number>,
  midi: ArrayLike<number>,
  frameRate: number,
): { start: number; end: number; midi: number }[] {
  const count = Math.min(dbfs.length, midi.length)
  const levels: number[] = []
  for (let i = 0; i < count; i++) if (Number.isFinite(dbfs[i])) levels.push(dbfs[i]!)
  if (levels.length === 0) return []
  levels.sort((a, b) => a - b)
  const threshold = levels[levels.length >> 1]! - DIP_DB
  const dipFrames = Math.max(1, Math.ceil(DIP_SECONDS * frameRate))
  const pieceFrames = Math.max(1, Math.ceil(PIECE_SECONDS * frameRate))

  const pieces: { start: number; end: number; midi: number }[] = []
  const keep = (start: number, end: number) => {
    if (end - start < pieceFrames) return
    const pitches: number[] = []
    for (let i = start; i < end; i++) if (Number.isFinite(midi[i])) pitches.push(midi[i]!)
    if (pitches.length === 0) return
    pitches.sort((a, b) => a - b)
    pieces.push({ start, end, midi: pitches[pitches.length >> 1]! })
  }
  let start = 0
  let dip = -1
  for (let i = 0; i <= count; i++) {
    const quiet = i < count && !(dbfs[i]! >= threshold)
    if (quiet) {
      if (dip < 0) dip = i
      continue
    }
    if (dip >= 0 && i - dip >= dipFrames) {
      keep(start, dip)
      start = i
    }
    dip = -1
  }
  keep(start, count)
  return pieces
}

/** How far below a note's pitch its entry or exit must reach to be a scoop or a fall, semitones. */
const EDGE_SEMITONES = 0.5
/** How long an entry or exit is looked at, seconds. */
const EDGE_SECONDS = 0.12

/**
 * Whether a found note was scooped into from below or fell off at the end. `midi` holds the
 * contour around the note (NaN where nothing is sung), the note itself at `[from, to)` with its
 * pitch `pitch`; the look reaches `EDGE_SECONDS` over each edge, since the pitch finder often
 * leaves the scoop or the fall just outside the note. A scoop climbs to the pitch from at least
 * half a semitone below; a fall drops that far below it.
 */
export function noteEdges(
  midi: ArrayLike<number>,
  from: number,
  to: number,
  pitch: number,
  frameRate: number,
): { scoop: boolean; fall: boolean } {
  const reach = Math.max(1, Math.round(EDGE_SECONDS * frameRate))
  const lowest = (start: number, end: number) => {
    let low = Infinity
    let at = -1
    for (let i = Math.max(0, start); i < Math.min(midi.length, end); i++) {
      const value = midi[i]!
      if (Number.isFinite(value) && value < low) {
        low = value
        at = i
      }
    }
    return { low, at }
  }
  const head = lowest(from - reach, from + reach)
  const tail = lowest(to - reach, to + reach)
  const deep = (low: number) => Number.isFinite(low) && pitch - low >= EDGE_SEMITONES
  // A scoop climbs: its lowest point comes before the note settles; a fall's comes after.
  const scoop = deep(head.low) && head.at < from + Math.round(reach / 2)
  const fall = deep(tail.low) && tail.at >= to - Math.round(reach / 2)
  return { scoop, fall }
}

/** Vibrato is heard at 4–9 wobbles a second, at least this wide either way, cents. */
const VIBRATO_RATE_LOW = 4
const VIBRATO_RATE_HIGH = 9
const VIBRATO_MIN_EXTENT = 25
/** Share of a note's frames that must wobble, and how long that must last, for it to have vibrato. */
const VIBRATO_SHARE = 0.4
const VIBRATO_SECONDS = 0.25

/**
 * Whether a note is sung with vibrato: a steady wobble of vibrato speed and width over a good part
 * of it, not a few frames that a glide or a scoop happens to look like.
 */
export function hasVibrato(
  rates: ArrayLike<number>,
  extents: ArrayLike<number>,
  frameRate: number,
): boolean {
  const count = Math.min(rates.length, extents.length)
  let wobbling = 0
  for (let i = 0; i < count; i++) {
    const rate = rates[i]!
    const extent = extents[i]!
    if (rate >= VIBRATO_RATE_LOW && rate <= VIBRATO_RATE_HIGH && extent >= VIBRATO_MIN_EXTENT) {
      wobbling++
    }
  }
  return wobbling >= VIBRATO_SHARE * count && wobbling >= VIBRATO_SECONDS * frameRate
}

/** Whole bars of `grid` that cover seconds `from` to `to`: at least one. */
export function barsAround(
  from: number,
  to: number,
  grid: Grid & { readonly beatsPerBar: number },
): { from: number; to: number } {
  const bar = grid.beatSeconds * grid.beatsPerBar
  const first = Math.floor((from - grid.origin) / bar + 1e-6)
  const last = Math.max(first + 1, Math.ceil((to - grid.origin) / bar - 1e-6))
  return { from: grid.origin + first * bar, to: grid.origin + last * bar }
}

/** `seconds` put on the nearest step of `grid`, a step being `beats` beats. */
export function snapSeconds(seconds: number, grid: Grid, beats: number): number {
  const step = grid.beatSeconds * beats
  return grid.origin + Math.round((seconds - grid.origin) / step) * step
}
