import { onScopeDispose, readonly, ref } from 'vue'
import { useCalibration } from '@/composables/useCalibration'
import type { ExerciseSession } from '@/composables/useExerciseSession'
import {
  CLIP_DB,
  HOLD_SECONDS,
  NOISE_MARGIN_DB,
  calibrationFault,
  heldLevel,
  steadySeconds,
  type CalibrationFault,
  type LevelSample,
  type LoudnessCalibration,
} from '@/training/calibration'

/** The room, then the three notes, in the order they are taken. */
export const CALIBRATION_STEPS = ['noise', 'quiet', 'comfortable', 'loud'] as const
export type CalibrationStep = (typeof CALIBRATION_STEPS)[number]

export type CalibrationRunStatus = 'idle' | 'running' | 'done'

/** Seconds of silence the room is listened to. */
const NOISE_SECONDS = 2
/** A note counts as held, and the tick settles, once it has been steady this long. */
const HOLDING_SECONDS = 0.5
/** dBFS a room measures when the input is digitally silent. */
const SILENT_DB = -120

/** What went wrong with the last note: a fault of the measures, or the input clipping. */
export type CalibrationTrouble = CalibrationFault | 'clipped'

/** The input the calibration is made for, kept once the microphone is off again. */
export interface CalibrationDevice {
  readonly name: string
  readonly sampleRate: number
}

/**
 * Taking a calibration: the room for two seconds, then a quiet, a comfortable and a loud note, each
 * held steadily for two seconds. Every note is checked against what came before it, and a note that
 * fails is asked for again. When all four are in, the calibration is saved for the input.
 */
export function useCalibrationRun(session: ExerciseSession) {
  const { saveCalibration } = useCalibration()

  const status = ref<CalibrationRunStatus>('idle')
  const step = ref(0)
  const measures = ref<Partial<LoudnessCalibration>>({})
  /** How far the current step has come, 0…1. */
  const progress = ref(0)
  /** A note has been steady long enough for the strip to show it. */
  const holding = ref(false)
  const trouble = ref<CalibrationTrouble | null>(null)
  const device = ref<CalibrationDevice | null>(null)

  let raf = 0
  let stepStart = 0
  let samples: LevelSample[] = []

  function reset(): void {
    step.value = 0
    measures.value = {}
    progress.value = 0
    holding.value = false
    trouble.value = null
    samples = []
  }

  async function start(): Promise<void> {
    cancelAnimationFrame(raf)
    reset()
    try {
      await session.startListening()
    } catch {
      // The session reports it in `error`.
      status.value = 'idle'
      return
    }
    const info = session.input.value
    device.value = {
      name: info?.label.trim() || 'Микрофон по умолчанию',
      sampleRate: info?.sampleRate ?? 0,
    }
    status.value = 'running'
    stepStart = performance.now() / 1000
    raf = requestAnimationFrame(frame)
  }

  function frame(now: number): void {
    raf = requestAnimationFrame(frame)
    if (session.micState.value !== 'running') return
    const time = now / 1000
    const dbfs = session.averageDbfs.value
    if (step.value === 0) listenToRoom(time, dbfs)
    else listenToNote(time, dbfs)
  }

  function listenToRoom(time: number, dbfs: number): void {
    progress.value = Math.min(1, (time - stepStart) / NOISE_SECONDS)
    if (progress.value < 1) return
    measures.value = { noise: Number.isFinite(dbfs) ? dbfs : SILENT_DB }
    next()
  }

  function listenToNote(time: number, dbfs: number): void {
    if (session.peakDbfs.value >= CLIP_DB) {
      samples = []
      progress.value = 0
      holding.value = false
      trouble.value = 'clipped'
      return
    }
    samples.push({ time, dbfs })
    while (samples.length > 0 && time - (samples[0]?.time ?? time) > HOLD_SECONDS + 1) {
      samples.shift()
    }
    if (trouble.value === 'clipped') trouble.value = null
    const floor = (measures.value.noise ?? SILENT_DB) + NOISE_MARGIN_DB
    const seconds = steadySeconds(samples, floor)
    // A level held where it cannot be right — no louder than the note before — is told so at once,
    // and does not count, instead of being taken and refused two seconds later.
    const id = CALIBRATION_STEPS[step.value] as Exclude<CalibrationStep, 'noise'>
    const fault =
      seconds >= HOLDING_SECONDS ? calibrationFault({ ...measures.value, [id]: dbfs }) : null
    if (fault !== null) {
      trouble.value = fault
      holding.value = false
      progress.value = 0
      return
    }
    trouble.value = null
    progress.value = Math.min(1, seconds / HOLD_SECONDS)
    if (seconds >= HOLDING_SECONDS) holding.value = true
    else if (seconds === 0) holding.value = false
    const level = heldLevel(samples, floor)
    if (level !== null) accept(level)
  }

  /** A note was held: keep it if it fits what came before, otherwise ask for it again. */
  function accept(level: number): void {
    const id = CALIBRATION_STEPS[step.value] as Exclude<CalibrationStep, 'noise'>
    const taken = { ...measures.value, [id]: level }
    samples = []
    progress.value = 0
    holding.value = false
    const fault = calibrationFault(taken)
    if (fault !== null) {
      trouble.value = fault
      return
    }
    trouble.value = null
    measures.value = taken
    next()
  }

  function next(): void {
    samples = []
    if (step.value < CALIBRATION_STEPS.length - 1) {
      step.value++
      progress.value = 0
      stepStart = performance.now() / 1000
      return
    }
    finish()
  }

  function finish(): void {
    cancelAnimationFrame(raf)
    const { noise, quiet, comfortable, loud } = measures.value
    const key = session.inputKey.value
    if (
      key !== null &&
      noise !== undefined &&
      quiet !== undefined &&
      comfortable !== undefined &&
      loud !== undefined
    ) {
      saveCalibration(key, { noise, quiet, comfortable, loud })
    }
    status.value = 'done'
    void session.stopListening()
  }

  onScopeDispose(() => cancelAnimationFrame(raf))

  return {
    status: readonly(status),
    /** Index into `CALIBRATION_STEPS`. */
    step: readonly(step),
    /** dBFS taken so far, by step. */
    measures: readonly(measures),
    progress: readonly(progress),
    holding: readonly(holding),
    trouble: readonly(trouble),
    device: readonly(device),
    /** Opens the microphone and starts from the room; also starts over. */
    start,
  }
}
