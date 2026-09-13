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
  const level = timeline.slice(column)
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
