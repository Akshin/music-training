/**
 * Loudness calibration: where one singer's quiet, comfortable and loud notes land on one input.
 *
 * The meter scale (0…1, see `components/loudness.ts`) is fixed, and the three notes are laid on the
 * centres of the quiet, middle and loud zones. Whatever the device does to the level — gain,
 * distance, compression — a zone then is the same height of the strip for every singer, and the
 * zones of the builder mean "of your own range". Without a calibration the scale is the plain
 * −60…0 dBFS.
 */
import { LOUDNESS_ZONES, type LoudnessZone } from '@/training/builder'

/** What the three notes and the room measured, all as the mean of a second in dBFS. */
export interface LoudnessCalibration {
  /** The room before singing. */
  readonly noise: number
  readonly quiet: number
  readonly comfortable: number
  readonly loud: number
}

/** dBFS at the bottom of the meter when nothing is calibrated. */
export const DEFAULT_FLOOR_DB = -60
/** dBFS under which a frame carries no pitch when nothing is calibrated: room noise otherwise. */
export const VOICE_FLOOR_DB = -55
/** The pitch gate never goes lower than this, however still the room is. */
const MIN_VOICE_FLOOR_DB = -70
/** How far the pitch gate stays under the quiet note. */
const VOICE_FLOOR_MARGIN_DB = 4

/** The quietest note has to stand this far above the room. */
export const NOISE_MARGIN_DB = 10
/** Each note has to be at least this much louder than the one before it. */
export const MIN_STEP_DB = 3
/** The loud note has to be at least this much louder than the quiet one: less is not a range. */
export const MIN_SPREAD_DB = 10

/** A level held this steadily for this long counts as a note sung for calibration. */
export const STEADY_DB = 3
export const HOLD_SECONDS = 2
/** Samples come once per animation frame, so the window may fall short of the full time by this. */
const HOLD_TOLERANCE_SECONDS = 0.1

function centreOf(zone: LoudnessZone): number {
  const option = LOUDNESS_ZONES.find((candidate) => candidate.zone === zone)
  return option === undefined ? 0 : (option.low + option.high) / 2
}

/** Where each calibration note sits on the meter scale: the centres of its zone. */
export const ANCHOR_LEVELS = {
  quiet: centreOf('soft'),
  comfortable: centreOf('good'),
  loud: centreOf('loud'),
} as const

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value))
}

/**
 * dBFS → meter level 0…1. Through the three notes the scale is straight between them and goes on
 * along the outer pieces; anything that is not a finite number reads as silence.
 */
export function levelMap(calibration: LoudnessCalibration | null): (dbfs: number) => number {
  // Notes out of order cannot be laid on a scale; it stays the plain one.
  if (
    calibration === null ||
    !(calibration.comfortable > calibration.quiet) ||
    !(calibration.loud > calibration.comfortable)
  ) {
    return (dbfs) =>
      Number.isFinite(dbfs) ? clamp01((dbfs - DEFAULT_FLOOR_DB) / -DEFAULT_FLOOR_DB) : 0
  }
  const { quiet, comfortable, loud } = calibration
  const lower = (ANCHOR_LEVELS.comfortable - ANCHOR_LEVELS.quiet) / (comfortable - quiet)
  const upper = (ANCHOR_LEVELS.loud - ANCHOR_LEVELS.comfortable) / (loud - comfortable)
  return (dbfs) => {
    if (!Number.isFinite(dbfs)) return 0
    if (dbfs <= comfortable) return clamp01(ANCHOR_LEVELS.quiet + (dbfs - quiet) * lower)
    return clamp01(ANCHOR_LEVELS.comfortable + (dbfs - comfortable) * upper)
  }
}

/** dBFS under which a frame carries no pitch: with a calibration, just above the room. */
export function voiceFloorDb(calibration: LoudnessCalibration | null): number {
  if (calibration === null) return VOICE_FLOOR_DB
  const aboveRoom = Math.max(calibration.noise + NOISE_MARGIN_DB, MIN_VOICE_FLOOR_DB)
  return Math.min(aboveRoom, calibration.quiet - VOICE_FLOOR_MARGIN_DB)
}

export type CalibrationFault =
  /** The quiet note is too close to the room: too noisy, or the input too quiet. */
  | 'noisy'
  /** A note is not louder than the one before it. */
  | 'order'
  /** From the quiet to the loud note there is too little range. */
  | 'narrow'

/** What is wrong with the measures so far, or null; whatever is not measured yet is not checked. */
export function calibrationFault(measures: Partial<LoudnessCalibration>): CalibrationFault | null {
  const { noise, quiet, comfortable, loud } = measures
  if (noise !== undefined && quiet !== undefined && quiet < noise + NOISE_MARGIN_DB) return 'noisy'
  if (quiet !== undefined && comfortable !== undefined && comfortable - quiet < MIN_STEP_DB) {
    return 'order'
  }
  if (comfortable !== undefined && loud !== undefined && loud - comfortable < MIN_STEP_DB) {
    return 'order'
  }
  if (quiet !== undefined && loud !== undefined && loud - quiet < MIN_SPREAD_DB) return 'narrow'
  return null
}

/** The mean of a second, in dBFS, at one moment in seconds. */
export interface LevelSample {
  readonly time: number
  readonly dbfs: number
}

/**
 * Where the steady tail of the samples starts: going back from the newest, as long as the samples
 * stand above `floorDb`, stay within `STEADY_DB` of each other and lie in the last `HOLD_SECONDS`.
 * The samples' length when even the newest is not steady.
 */
function steadyStart(samples: readonly LevelSample[], floorDb: number): number {
  const last = samples[samples.length - 1]
  if (last === undefined) return 0
  let min = Infinity
  let max = -Infinity
  let start = samples.length
  for (let i = samples.length - 1; i >= 0; i--) {
    const sample = samples[i]!
    if (last.time - sample.time > HOLD_SECONDS || !(sample.dbfs >= floorDb)) break
    min = Math.min(min, sample.dbfs)
    max = Math.max(max, sample.dbfs)
    if (max - min > STEADY_DB) break
    start = i
  }
  return start
}

/** How long, up to `HOLD_SECONDS`, the level has been steady: the progress of a held note. */
export function steadySeconds(samples: readonly LevelSample[], floorDb: number): number {
  const last = samples[samples.length - 1]
  const first = samples[steadyStart(samples, floorDb)]
  return last === undefined || first === undefined ? 0 : last.time - first.time
}

/**
 * The level of a note held for `HOLD_SECONDS`: the median of those seconds, once they all stand
 * above `floorDb` and stay within `STEADY_DB` of each other; otherwise null. Samples run oldest
 * first.
 */
export function heldLevel(samples: readonly LevelSample[], floorDb: number): number | null {
  const start = steadyStart(samples, floorDb)
  if (steadySeconds(samples, floorDb) < HOLD_SECONDS - HOLD_TOLERANCE_SECONDS) return null
  const sorted = samples
    .slice(start)
    .map((sample) => sample.dbfs)
    .sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)] ?? null
}

/** A peak this high means the input clipped: the level is not the voice's any more. */
export const CLIP_DB = -1

/** Whether an input looks like a Bluetooth headset, which processes the voice on its own. */
export function looksBluetooth(label: string, sampleRate: number): boolean {
  return (
    /airpods|bluetooth|hands-?free|beats|buds/i.test(label) ||
    (sampleRate > 0 && sampleRate <= 24000)
  )
}

/**
 * What a calibration is stored under: the name of the input, which stays the same when the browser
 * hands out a new id, and the id when the name is hidden.
 */
export function inputKey(label: string, deviceId: string | undefined): string {
  return label.trim() || deviceId || 'default'
}
