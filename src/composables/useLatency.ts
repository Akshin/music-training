import { ref } from 'vue'

const KEY = 'music-training:latency'

/**
 * Version of what is stored, written next to it as `{ version, data }`: seconds by the devices
 * they were measured on (`deviceKey`). Like a loudness calibration, it belongs to this hardware and
 * stays in this browser.
 */
const STORAGE_VERSION = 1

/** Measured latency beyond what the browser reports, seconds, by device. */
type Records = Record<string, number>

/** Anything outside this is not a latency a device could have, seconds. */
const LIMIT_SECONDS = 1

function load(): Records {
  try {
    const text = localStorage.getItem(KEY)
    if (text === null) return {}
    const envelope = JSON.parse(text) as { data?: unknown } | null
    const data = envelope?.data
    if (typeof data !== 'object' || data === null) return {}
    const records: Records = {}
    for (const [device, value] of Object.entries(data)) {
      if (typeof value === 'number' && Math.abs(value) <= LIMIT_SECONDS) records[device] = value
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
    // Private mode or a full quota: the measurement lasts until the page is closed.
  }
}

// One state for the app: every session applies what was measured for its devices.
const records = ref<Records>(load())

/** Latency measured on this browser's devices, beyond what the browser itself reports. */
export function useLatency() {
  return {
    /** Seconds measured for a device pair; null when it was not measured. */
    latencyOf(device: string | null | undefined): number | null {
      return device ? (records.value[device] ?? null) : null
    },
    saveLatency(device: string, seconds: number): void {
      records.value = { ...records.value, [device]: seconds }
      store(records.value)
    },
    clearLatency(device: string): void {
      const { [device]: _removed, ...rest } = records.value
      records.value = rest
      store(rest)
    },
  }
}
