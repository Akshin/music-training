/**
 * Onsets from a level column: a rising edge through the gate, then a refractory gap.
 *
 * Used by latency calibration (click → recorded burst) and as a rhythm feature. Adaptive gate
 * matches the phrase segmenter: 10th percentile + margin, never below `minGateDb`.
 */

import { percentile } from '../segmentation/phrases'
import type { Timeline } from '../model/timeline'

export interface OnsetOptions {
  readonly gateDb?: number
  readonly minGateDb?: number
  readonly gateAboveFloorDb?: number
  /** Minimum time between onsets, seconds. Default 0.08. */
  readonly minGapSeconds?: number
  readonly levelColumn?: string
}

export function onsetTimes(timeline: Timeline, options: OnsetOptions = {}): number[] {
  const column = options.levelColumn ?? 'dbfs'
  if (!timeline.hasColumn(column) || timeline.length === 0) return []
  const level = timeline.alignedSlice(column)
  const floor = percentile(level, 0.1)
  const gate =
    options.gateDb ??
    Math.max(
      options.minGateDb ?? -50,
      (Number.isFinite(floor) ? floor : -120) + (options.gateAboveFloorDb ?? 18),
    )
  const minGap = Math.max(1, Math.round((options.minGapSeconds ?? 0.08) * timeline.frameRate))
  const times: number[] = []
  let last = -minGap
  let armed = true
  for (let i = 0; i < level.length; i++) {
    const loud = level[i] > gate
    if (loud && armed && i - last >= minGap) {
      times.push(timeline.frameTime(i))
      last = i
      armed = false
    }
    if (!loud) armed = true
  }
  return times
}

export interface PcmOnsetOptions {
  /** Envelope resolution, seconds. Default 0.001. */
  readonly blockSeconds?: number
  /** Gate above the noise floor (10th percentile of the envelope), dB. Default 20. */
  readonly gateAboveFloorDb?: number
  /** The gate never drops below this, dBFS. Default -60. */
  readonly minGateDb?: number
  /** Minimum time between onsets, seconds: room echo of a click is not a second click. Default 0.15. */
  readonly minGapSeconds?: number
}

/**
 * Onsets straight from PCM, to the sample: the first sample past the gate after the sound was below
 * it. A level column cannot do this — its 43 ms window lights up half a window before a click and
 * stays lit half a window after — so latency calibration reads the samples. Times are seconds from
 * `samples[0]`.
 */
export function pcmOnsets(
  samples: Float32Array,
  sampleRate: number,
  options: PcmOnsetOptions = {},
): number[] {
  const block = Math.max(1, Math.round((options.blockSeconds ?? 0.001) * sampleRate))
  const blocks = Math.floor(samples.length / block)
  if (blocks === 0) return []
  const envelope = new Float32Array(blocks)
  for (let b = 0; b < blocks; b++) {
    let peak = 0
    for (let i = b * block; i < (b + 1) * block; i++) peak = Math.max(peak, Math.abs(samples[i]))
    envelope[b] = peak > 0 ? 20 * Math.log10(peak) : -Infinity
  }
  const floor = percentile(envelope, 0.1)
  const gateDb = Math.max(
    options.minGateDb ?? -60,
    (Number.isFinite(floor) ? floor : -120) + (options.gateAboveFloorDb ?? 20),
  )
  const gate = 10 ** (gateDb / 20)
  const minGap = Math.round((options.minGapSeconds ?? 0.15) * sampleRate)
  const onsets: number[] = []
  let last = -Infinity
  let armed = true
  for (let b = 0; b < blocks; b++) {
    const loud = envelope[b] > gateDb
    if (loud && armed) {
      let at = b * block
      while (Math.abs(samples[at]) <= gate) at++
      if (at - last >= minGap) {
        onsets.push(at / sampleRate)
        last = at
      }
      armed = false
    }
    if (!loud) armed = true
  }
  return onsets
}
