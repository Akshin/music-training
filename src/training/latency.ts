/**
 * Latency calibration: how much later than the browser says a click comes back through the
 * microphone. The session already counts the output latency the browser reports; what it cannot
 * know is the rest — the microphone's own delay, Bluetooth buffers, a reported latency that is
 * wrong. A run of clicks is played, found in the recording, and the median of how late each one
 * landed is that rest. Without headphones the speaker reaches the microphone by itself; in
 * headphones the singer says «та» on every click instead.
 */
import { estimateLatency } from '@audio-core/core/index'

/** Clicks measured in one run. */
export const LATENCY_CLICKS = 8
/** Tempo of the clicks: far enough apart that a late click is not taken for the next one. */
export const LATENCY_BPM = 80
/** Share of the clicks that must be found for the run to count. */
const MIN_HIT_SHARE = 0.75
/** Spread of the clicks around their median beyond which the run is too unsteady to trust, seconds. */
const MAX_SPREAD_SECONDS = 0.02
/** Beyond this the measurement is more likely a mistake than a device, seconds. */
const MAX_SECONDS = 0.4

export interface RoundTrip {
  /** Seconds the clicks came back later than expected; negative when earlier. */
  readonly seconds: number
  /** Median distance of single clicks from `seconds`. */
  readonly spread: number
  readonly hits: number
  readonly expected: number
}

/**
 * The run measured: clicks expected at `expected` and sounds found at `onsets`, both seconds on
 * the same clock. A sound is matched to a click within half the distance between clicks.
 */
export function measureRoundTrip(
  expected: readonly number[],
  onsets: readonly number[],
): RoundTrip | null {
  const gap =
    expected.length > 1
      ? (expected[expected.length - 1]! - expected[0]!) / (expected.length - 1)
      : 1
  const estimate = estimateLatency(expected, onsets, { window: gap / 2 })
  if (estimate === undefined) return null
  const deviations = estimate.offsets.map((offset) => Math.abs(offset - estimate.seconds))
  return {
    seconds: estimate.seconds,
    spread: median(deviations),
    hits: estimate.hits,
    expected: estimate.expected,
  }
}

export type RoundTripFault = 'silent' | 'few' | 'unsteady' | 'far'

/** Why a run cannot be trusted, or null when it can. */
export function roundTripFault(trip: RoundTrip | null): RoundTripFault | null {
  if (trip === null || trip.hits === 0) return 'silent'
  if (trip.hits < Math.ceil(trip.expected * MIN_HIT_SHARE)) return 'few'
  if (trip.spread > MAX_SPREAD_SECONDS) return 'unsteady'
  if (Math.abs(trip.seconds) > MAX_SECONDS) return 'far'
  return null
}

/**
 * What a latency is stored under: the input and the output it was measured on. Either can change
 * the delay — AirPods as the output add their buffer even with the laptop's microphone. A browser
 * that does not name its outputs leaves the input alone.
 */
export function deviceKey(input: string, output: string): string {
  return output.trim() ? `${input} → ${output.trim()}` : input
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = sorted.length >> 1
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2
}
