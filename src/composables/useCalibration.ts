import { ref } from 'vue'
import { calibrationFault, type LoudnessCalibration } from '@/training/calibration'

const KEY = 'music-training:loudness-calibration'

/**
 * Version of what is stored, written next to it as `{ version, data }`: the calibrations by the
 * name of the input they were made on. A calibration belongs to that hardware, so it stays in this
 * browser and does not follow the account.
 */
const STORAGE_VERSION = 1

type Records = Record<string, LoudnessCalibration>

/** A calibration as it was stored, or null when it is damaged or its notes do not make a range. */
function parse(value: unknown): LoudnessCalibration | null {
  const stored = value as Partial<Record<keyof LoudnessCalibration, unknown>> | null
  const { noise, quiet, comfortable, loud } = stored ?? {}
  if (
    typeof noise !== 'number' ||
    typeof quiet !== 'number' ||
    typeof comfortable !== 'number' ||
    typeof loud !== 'number'
  ) {
    return null
  }
  const calibration = { noise, quiet, comfortable, loud }
  const finite = Object.values(calibration).every(Number.isFinite)
  return finite && calibrationFault(calibration) === null ? calibration : null
}

function load(): Records {
  try {
    const text = localStorage.getItem(KEY)
    if (text === null) return {}
    const envelope = JSON.parse(text) as { data?: unknown } | null
    const data = envelope?.data
    if (typeof data !== 'object' || data === null) return {}
    const records: Records = {}
    for (const [input, value] of Object.entries(data)) {
      const calibration = parse(value)
      if (calibration !== null) records[input] = calibration
    }
    return records
  } catch {
    return {}
  }
}

function store(records: Records): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ version: STORAGE_VERSION, data: records }))
  } catch {
    // Private mode or a full quota: the calibration lasts until the page is closed.
  }
}

// One state for the app, like the trainings: the session and the calibration page read the same.
const records = ref<Records>(load())

/** Loudness calibrations of this browser's inputs, by the name of the input (`inputKey`). */
export function useCalibration() {
  return {
    /** The calibration of an input; null when there is none, or the input is not known yet. */
    calibrationOf(input: string | null | undefined): LoudnessCalibration | null {
      return input ? (records.value[input] ?? null) : null
    },
    saveCalibration(input: string, calibration: LoudnessCalibration): void {
      records.value = { ...records.value, [input]: calibration }
      store(records.value)
    },
    clearCalibration(input: string): void {
      const { [input]: _removed, ...rest } = records.value
      records.value = rest
      store(rest)
    },
  }
}
