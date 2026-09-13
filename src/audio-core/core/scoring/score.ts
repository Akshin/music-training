/**
 * Compare sung notes to a reference on the same BeatGrid.
 *
 * Pitch is cents off the target MIDI. Rhythm is the onset error after subtracting the calibrated
 * latency. Level is mean dBFS over the sung frames versus a reference derived from velocity
 * (0 dBFS at velocity 1, −12 dBFS at 0.25 — a gentle curve, not a mix spec). Unmatched targets
 * score 0. The three axes are independent; `overall` is their mean over matched notes.
 */

import type { BeatGrid } from '../clock/beat-grid'
import { centsBetween, midiToHz } from '../model/pitch'
import { noteEnd, type NoteEvent } from '../model/note'
import type { NoteSegment } from '../segmentation/types'
import type { Timeline } from '../model/timeline'

export interface ScoreOptions {
  /** Half-width of the "in tune" band, cents. Default 50. */
  readonly pitchToleranceCents?: number
  /** Half-width of the "in time" band, seconds. Default 0.08. */
  readonly rhythmToleranceSeconds?: number
  /** Subtracted from sung start times (see `estimateLatency`). Default 0. */
  readonly latencySeconds?: number
  /** How far a sung onset may sit from a target, seconds. Default 0.45. */
  readonly matchWindowSeconds?: number
  /** Level error (dB) that scores 0. Default 18. */
  readonly levelToleranceDb?: number
}

export interface PitchScore {
  readonly cents: number
  readonly absCents: number
  readonly inTune: boolean
  /** 1 at 0 cents, 0 at 2× tolerance. */
  readonly value: number
}

export interface RhythmScore {
  /** Positive = late, after latency correction. */
  readonly offsetSeconds: number
  readonly offsetBeats: number
  readonly inTime: boolean
  readonly value: number
}

export interface LevelScore {
  readonly dbfs: number
  readonly targetDb: number
  readonly errorDb: number
  readonly value: number
}

export interface NoteScore {
  readonly target: NoteEvent
  readonly sung: NoteSegment | undefined
  readonly pitch: PitchScore | undefined
  readonly rhythm: RhythmScore | undefined
  readonly level: LevelScore | undefined
}

export interface TakeScore {
  readonly notes: readonly NoteScore[]
  readonly matched: number
  readonly pitch: number
  readonly rhythm: number
  readonly level: number
  readonly overall: number
}

const DEFAULTS = {
  pitchToleranceCents: 50,
  rhythmToleranceSeconds: 0.08,
  latencySeconds: 0,
  matchWindowSeconds: 0.45,
  levelToleranceDb: 18,
}

export function scoreTake(
  targets: readonly NoteEvent[],
  sung: readonly NoteSegment[],
  grid: BeatGrid,
  timeline?: Timeline,
  options: ScoreOptions = {},
): TakeScore {
  const pitchTol = options.pitchToleranceCents ?? DEFAULTS.pitchToleranceCents
  const rhythmTol = options.rhythmToleranceSeconds ?? DEFAULTS.rhythmToleranceSeconds
  const latency = options.latencySeconds ?? DEFAULTS.latencySeconds
  const matchWindow = options.matchWindowSeconds ?? DEFAULTS.matchWindowSeconds
  const levelTol = options.levelToleranceDb ?? DEFAULTS.levelToleranceDb

  const available = sung.map((note, index) => ({ note, index, used: false }))
  const notes: NoteScore[] = targets.map((target) => {
    const expected = grid.beatToSeconds(target.startBeat)
    let best: (typeof available)[number] | undefined
    let bestAbs = matchWindow
    for (const entry of available) {
      if (entry.used) continue
      const abs = Math.abs(entry.note.startTime - latency - expected)
      if (abs <= bestAbs) {
        bestAbs = abs
        best = entry
      }
    }
    if (best === undefined) {
      return { target, sung: undefined, pitch: undefined, rhythm: undefined, level: undefined }
    }
    best.used = true
    const detected = best.note
    const cents = centsBetween(midiToHz(detected.midi), midiToHz(target.midi))
    const absCents = Math.abs(cents)
    const offsetSeconds = detected.startTime - latency - expected
    const dbfs = meanDb(timeline, detected.startFrame, detected.endFrame)
    const targetDb = velocityToDb(target.velocity ?? 1)
    const errorDb = dbfs - targetDb
    return {
      target,
      sung: detected,
      pitch: {
        cents,
        absCents,
        inTune: absCents <= pitchTol,
        value: unit(absCents, pitchTol * 2),
      },
      rhythm: {
        offsetSeconds,
        offsetBeats: offsetSeconds / grid.secondsPerBeat,
        inTime: Math.abs(offsetSeconds) <= rhythmTol,
        value: unit(Math.abs(offsetSeconds), rhythmTol * 2),
      },
      level: Number.isFinite(dbfs)
        ? {
            dbfs,
            targetDb,
            errorDb,
            value: unit(Math.abs(errorDb), levelTol),
          }
        : undefined,
    }
  })

  const matched = notes.filter((note) => note.sung !== undefined)
  const mean = (pick: (note: NoteScore) => number | undefined) => {
    if (targets.length === 0) return 1
    let sum = 0
    for (const note of notes) sum += pick(note) ?? 0
    return sum / targets.length
  }
  const pitch = mean((note) => note.pitch?.value)
  const rhythm = mean((note) => note.rhythm?.value)
  const hasLevel = notes.some((note) => note.level !== undefined)
  const level = hasLevel ? mean((note) => note.level?.value) : 1
  const overall =
    targets.length === 0 ? 1 : hasLevel ? (pitch + rhythm + level) / 3 : (pitch + rhythm) / 2

  return { notes, matched: matched.length, pitch, rhythm, level, overall }
}

function unit(error: number, failAt: number): number {
  if (!(failAt > 0)) return error === 0 ? 1 : 0
  return Math.max(0, 1 - error / failAt)
}

/** Velocity 1 → 0 dBFS, 0.25 → −12 dBFS. */
export function velocityToDb(velocity: number): number {
  const v = Math.max(1e-6, Math.min(1, velocity))
  return 20 * Math.log10(v)
}

function meanDb(timeline: Timeline | undefined, start: number, end: number): number {
  if (timeline === undefined || !timeline.hasColumn('dbfs') || end <= start) return NaN
  let sum = 0
  let n = 0
  for (let i = start; i < end && i < timeline.length; i++) {
    const value = timeline.get('dbfs', i)
    if (Number.isFinite(value)) {
      sum += value
      n++
    }
  }
  return n === 0 ? NaN : sum / n
}

export function noteEndTime(note: NoteEvent, grid: BeatGrid): number {
  return grid.beatToSeconds(noteEnd(note))
}
