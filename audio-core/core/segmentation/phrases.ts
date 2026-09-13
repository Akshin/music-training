/**
 * Phrase segmentation: splits a timeline range into sounds separated by pauses.
 *
 * Works on the per-frame level (`dbfs`) with an adaptive gate: the noise floor is the 10th
 * percentile of the range, the gate sits a fixed margin above it. Short pauses are bridged and
 * short blips dropped, which is the hysteresis a vocal exercise needs — a consonant is not a
 * pause, a click is not a phrase.
 */

import type { Timeline } from '../model/timeline'
import type { Phrase } from './types'

export interface PhraseOptions {
  /** Fixed gate in dBFS. When omitted the gate adapts to the noise floor. */
  readonly gateDb?: number
  /** Adaptive gate margin above the noise floor, dB. Default 15. */
  readonly gateAboveFloorDb?: number
  /** The adaptive gate never drops below this, dBFS. Default -65. */
  readonly minGateDb?: number
  /** Pauses shorter than this do not split a phrase, ms. Default 150. */
  readonly minPauseMs?: number
  /** Sounds shorter than this are discarded, ms. Default 120. */
  readonly minPhraseMs?: number
  /** Column with per-frame level in dBFS. Default 'dbfs'. */
  readonly levelColumn?: string
  /** Column with f0 confidence, used for `voicedRatio`. Default 'f0Confidence'. */
  readonly confidenceColumn?: string
  /** Confidence at or above which a frame counts as voiced. Default 0.5. */
  readonly voicingThreshold?: number
}

export interface PhraseSegmentation {
  readonly phrases: readonly Phrase[]
  readonly gateDb: number
  readonly noiseFloorDb: number
}

const DEFAULTS = {
  gateAboveFloorDb: 15,
  minGateDb: -65,
  minPauseMs: 150,
  minPhraseMs: 120,
  levelColumn: 'dbfs',
  confidenceColumn: 'f0Confidence',
  voicingThreshold: 0.5,
} as const

/** Value below which `share` of the (finite) values lie. */
export function percentile(values: Float32Array, share: number): number {
  const finite = Array.from(values).filter((v) => Number.isFinite(v))
  if (finite.length === 0) return NaN
  finite.sort((a, b) => a - b)
  const position = Math.min(finite.length - 1, Math.max(0, Math.floor(share * (finite.length - 1))))
  return finite[position]
}

/** Runs of `true` in `flags` as half-open `[start, end)` pairs. */
export function runsOf(flags: Uint8Array): Array<[number, number]> {
  const runs: Array<[number, number]> = []
  let start = -1
  for (let i = 0; i < flags.length; i++) {
    if (flags[i] !== 0 && start < 0) start = i
    if (flags[i] === 0 && start >= 0) {
      runs.push([start, i])
      start = -1
    }
  }
  if (start >= 0) runs.push([start, flags.length])
  return runs
}

export function segmentPhrases(
  timeline: Timeline,
  startFrame = 0,
  endFrame = timeline.length,
  options: PhraseOptions = {},
): PhraseSegmentation {
  const levelColumn = options.levelColumn ?? DEFAULTS.levelColumn
  const confidenceColumn = options.confidenceColumn ?? DEFAULTS.confidenceColumn
  const voicingThreshold = options.voicingThreshold ?? DEFAULTS.voicingThreshold
  const framesPerMs = timeline.frameRate / 1000
  const minPause = Math.max(
    1,
    Math.round((options.minPauseMs ?? DEFAULTS.minPauseMs) * framesPerMs),
  )
  const minPhrase = Math.max(
    1,
    Math.round((options.minPhraseMs ?? DEFAULTS.minPhraseMs) * framesPerMs),
  )

  const end = Math.min(endFrame, timeline.length)
  const start = Math.max(0, Math.min(startFrame, end))
  const count = end - start
  const level = timeline.slice(levelColumn, start, end)
  const confidence = timeline.columns.includes(confidenceColumn)
    ? timeline.slice(confidenceColumn, start, end)
    : undefined

  const noiseFloorDb = count === 0 ? NaN : percentile(level, 0.1)
  const gateDb =
    options.gateDb ??
    Math.max(
      options.minGateDb ?? DEFAULTS.minGateDb,
      (Number.isFinite(noiseFloorDb) ? noiseFloorDb : -120) +
        (options.gateAboveFloorDb ?? DEFAULTS.gateAboveFloorDb),
    )

  const active = new Uint8Array(count)
  for (let i = 0; i < count; i++) active[i] = level[i] > gateDb ? 1 : 0

  // Bridge short pauses, then drop short sounds.
  let runs = runsOf(active)
  for (let i = 1; i < runs.length; i++) {
    const gap = runs[i][0] - runs[i - 1][1]
    if (gap < minPause) active.fill(1, runs[i - 1][1], runs[i][0])
  }
  runs = runsOf(active).filter(([a, b]) => b - a >= minPhrase)

  const phrases: Phrase[] = runs.map(([a, b]) => {
    let peak = -Infinity
    let sum = 0
    let voiced = 0
    for (let i = a; i < b; i++) {
      const db = level[i]
      if (db > peak) peak = db
      sum += db
      if (confidence !== undefined && confidence[i] >= voicingThreshold) voiced++
    }
    const startFrameAbs = start + a
    const endFrameAbs = start + b
    const startTime = timeline.frameTime(startFrameAbs)
    const endTime = timeline.frameTime(endFrameAbs)
    return {
      startFrame: startFrameAbs,
      endFrame: endFrameAbs,
      startTime,
      endTime,
      duration: endTime - startTime,
      peakDb: peak,
      meanDb: sum / (b - a),
      voicedRatio: confidence === undefined ? NaN : voiced / (b - a),
    }
  })

  return { phrases, gateDb, noiseFloorDb }
}
