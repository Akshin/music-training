/**
 * Note transcription in the style of Mauch et al. 2015 (Tony): a sparse-ish HMM over silence plus
 * integer MIDI, observed from the per-frame `midi` / `dbfs` / `f0Confidence` columns.
 *
 * This is the take-level alternative to the greedy contour walker in `notes.ts`. It does not emit
 * slides — portamento is absorbed into the neighbouring notes or left as a pitch step. Live `/lab`
 * still uses the greedy pass while recording; Mauch runs once on Stop / on a file.
 */

import { centsOffNearest, nearestMidi } from '../model/pitch'
import type { Timeline } from '../model/timeline'
import { median } from './notes'
import type { NoteSegment, NoteTransition } from './types'

export interface MauchOptions {
  /** Lowest MIDI state. Default 36 (C2). */
  readonly midiMin?: number
  /** Highest MIDI state. Default 84 (C6). */
  readonly midiMax?: number
  /** Shortest note after Viterbi, ms. Default 80. */
  readonly minNoteMs?: number
  /** Gaussian observation width, semitones. Default 0.55. */
  readonly sigma?: number
  /** Unvoiced gap that counts as a `gap` transition, ms. Default 40. */
  readonly gapMinMs?: number
  /** Frames quieter than this are silence, dBFS. Default −50. */
  readonly gateDb?: number
  readonly midiColumn?: string
  readonly confidenceColumn?: string
  readonly levelColumn?: string
  readonly voicingThreshold?: number
}

const DEFAULTS = {
  midiMin: 36,
  midiMax: 84,
  minNoteMs: 80,
  sigma: 0.55,
  gapMinMs: 40,
  gateDb: -50,
  midiColumn: 'midi',
  confidenceColumn: 'f0Confidence',
  levelColumn: 'dbfs',
  voicingThreshold: 0.5,
} as const

const LOG_EPS = -30
const LOG_SILENCE_VOICED = Math.log(0.06)
const LOG_NOTE_VOICED = Math.log(0.94)
const LOG_STAY = Math.log(0.985)
const LOG_TO_SILENCE = Math.log(0.01)
const LOG_FROM_SILENCE = Math.log(0.12)
const LOG_SILENCE_STAY = Math.log(0.88)

interface Resolved {
  readonly midiMin: number
  readonly nNotes: number
  readonly silent: number
  readonly nState: number
  readonly minNote: number
  readonly gapMin: number
  readonly sigma: number
  readonly gateDb: number
  readonly voicingThreshold: number
}

function resolve(timeline: Timeline, options: MauchOptions): Resolved {
  const midiMin = options.midiMin ?? DEFAULTS.midiMin
  const midiMax = options.midiMax ?? DEFAULTS.midiMax
  const nNotes = midiMax - midiMin + 1
  const framesPerMs = timeline.frameRate / 1000
  return {
    midiMin,
    nNotes,
    silent: nNotes,
    nState: nNotes + 1,
    minNote: Math.max(1, Math.round((options.minNoteMs ?? DEFAULTS.minNoteMs) * framesPerMs)),
    gapMin: Math.max(1, Math.round((options.gapMinMs ?? DEFAULTS.gapMinMs) * framesPerMs)),
    sigma: options.sigma ?? DEFAULTS.sigma,
    gateDb: options.gateDb ?? DEFAULTS.gateDb,
    voicingThreshold: options.voicingThreshold ?? DEFAULTS.voicingThreshold,
  }
}

function logSwitch(semitones: number): number {
  return Math.log(0.012) - 0.55 * semitones
}

function logTransition(from: number, to: number, cfg: Resolved): number {
  const { silent } = cfg
  if (from === silent && to === silent) return LOG_SILENCE_STAY
  if (from === silent) return LOG_FROM_SILENCE
  if (to === silent) return LOG_TO_SILENCE
  if (from === to) return LOG_STAY
  return logSwitch(Math.abs(from - to))
}

function fillObs(obs: Float64Array, midi: number, dbfs: number, conf: number, cfg: Resolved): void {
  obs.fill(LOG_EPS)
  const quiet = !(dbfs > cfg.gateDb)
  const voiced = !quiet && conf >= cfg.voicingThreshold && Number.isFinite(midi)
  if (!voiced) {
    obs[cfg.silent] = 0
    return
  }
  obs[cfg.silent] = LOG_SILENCE_VOICED
  const { midiMin, nNotes, sigma } = cfg
  for (let k = 0; k < nNotes; k++) {
    const d = midi - (midiMin + k)
    obs[k] = LOG_NOTE_VOICED - 0.5 * (d / sigma) * (d / sigma)
  }
}

function viterbi(
  timeline: Timeline,
  startFrame: number,
  count: number,
  cfg: Resolved,
  options: MauchOptions,
): Int32Array {
  const midiColumn = options.midiColumn ?? DEFAULTS.midiColumn
  const levelColumn = options.levelColumn ?? DEFAULTS.levelColumn
  const confidenceColumn = options.confidenceColumn ?? DEFAULTS.confidenceColumn
  const hasConf = timeline.columns.includes(confidenceColumn)
  const { nState, silent } = cfg
  const obs = new Float64Array(nState)
  const score = new Float64Array(nState)
  const prev = new Float64Array(nState)
  const back = new Int32Array(count * nState)
  prev.fill(LOG_EPS)
  prev[silent] = 0

  for (let t = 0; t < count; t++) {
    const frame = startFrame + t
    const midi = timeline.get(midiColumn, frame)
    const dbfs = timeline.get(levelColumn, frame)
    const conf = hasConf ? timeline.get(confidenceColumn, frame) : Number.isFinite(midi) ? 1 : 0
    fillObs(obs, midi, dbfs, conf, cfg)
    const offset = t * nState
    for (let s = 0; s < nState; s++) {
      let best = -Infinity
      let pred = silent
      for (let p = 0; p < nState; p++) {
        const val = prev[p] + logTransition(p, s, cfg)
        if (val > best) {
          best = val
          pred = p
        }
      }
      score[s] = best + obs[s]
      back[offset + s] = pred
    }
    prev.set(score)
  }

  let state = 0
  let best = -Infinity
  for (let s = 0; s < nState; s++) {
    if (prev[s] > best) {
      best = prev[s]
      state = s
    }
  }
  const path = new Int32Array(count)
  for (let t = count - 1; t >= 0; t--) {
    path[t] = state
    if (t === 0) break
    state = back[t * nState + state]
  }
  return path
}

function dropShort(path: Int32Array, silent: number, minNote: number): void {
  let start = 0
  while (start < path.length) {
    let end = start + 1
    while (end < path.length && path[end] === path[start]) end++
    if (path[start] !== silent && end - start < minNote) {
      const left = start > 0 ? path[start - 1] : silent
      const right = end < path.length ? path[end] : silent
      const fill = left === right && left !== silent ? left : silent
      path.fill(fill, start, end)
    }
    start = end
  }
}

function noteStats(
  timeline: Timeline,
  midiColumn: string,
  from: number,
  to: number,
): {
  midi: number
  note: number
  cents: number
  spreadCents: number
  voicedFrames: number
} {
  const values: number[] = []
  for (let i = from; i < to; i++) {
    const midi = timeline.get(midiColumn, i)
    if (Number.isFinite(midi)) values.push(midi)
  }
  const mid = median(values)
  const note = nearestMidi(mid)
  const deviations = values.map((v) => Math.abs(v - mid))
  return {
    midi: mid,
    note,
    cents: centsOffNearest(mid),
    spreadCents: median(deviations) * 100,
    voicedFrames: values.length,
  }
}

/**
 * Tony-style note list over `[startFrame, endFrame)`. `phrase` is 0; `segmentTake` rewrites it
 * against the phrase list. No slides.
 */
export function transcribeNotes(
  timeline: Timeline,
  startFrame = 0,
  endFrame = timeline.length,
  options: MauchOptions = {},
): NoteSegment[] {
  const count = endFrame - startFrame
  if (count <= 0) return []
  const cfg = resolve(timeline, options)
  const path = viterbi(timeline, startFrame, count, cfg, options)
  dropShort(path, cfg.silent, cfg.minNote)

  const midiColumn = options.midiColumn ?? DEFAULTS.midiColumn
  const notes: NoteSegment[] = []
  let cursor = 0
  let previousEnd = -1
  while (cursor < count) {
    if (path[cursor] === cfg.silent) {
      cursor++
      continue
    }
    const state = path[cursor]
    let end = cursor + 1
    while (end < count && path[end] === state) end++
    const startAbs = startFrame + cursor
    const endAbs = startFrame + end
    const startTime = timeline.frameTime(startAbs)
    const endTime = timeline.frameTime(endAbs)
    const s = noteStats(timeline, midiColumn, startAbs, endAbs)
    let transition: NoteTransition = 'attack'
    if (previousEnd >= 0) {
      const gap = startAbs - previousEnd
      transition = gap > cfg.gapMin ? 'gap' : 'legato'
    }
    notes.push({
      startFrame: startAbs,
      endFrame: endAbs,
      startTime,
      endTime,
      duration: endTime - startTime,
      phrase: 0,
      midi: s.midi,
      note: s.note,
      cents: s.cents,
      spreadCents: s.spreadCents,
      voicedFrames: s.voicedFrames,
      transition,
    })
    previousEnd = endAbs
    cursor = end
  }
  return notes
}
