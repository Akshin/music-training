/**
 * Means of contour columns over a take. NaN columns are skipped; empty → NaN.
 */

import type { Timeline } from '../model/timeline'

export interface ContourSummary {
  readonly frames: number
  readonly voiced: number
  readonly lufsMomentary: number
  readonly lufsShortTerm: number
  readonly lufsIntegrated: number
  readonly vibratoRate: number
  readonly vibratoExtent: number
  readonly f1: number
  readonly f2: number
  readonly f3: number
  readonly cpp: number
}

export function summarizeContour(timeline: Timeline): ContourSummary {
  return {
    frames: timeline.length,
    voiced: countFinite(timeline, 'f0'),
    lufsMomentary: lastFinite(timeline, 'lufsMomentary'),
    lufsShortTerm: lastFinite(timeline, 'lufsShortTerm'),
    lufsIntegrated: lastFinite(timeline, 'lufsIntegrated'),
    vibratoRate: columnMean(timeline, 'vibratoRate'),
    vibratoExtent: columnMean(timeline, 'vibratoExtent'),
    f1: columnMean(timeline, 'f1'),
    f2: columnMean(timeline, 'f2'),
    f3: columnMean(timeline, 'f3'),
    cpp: columnMean(timeline, 'cpp'),
  }
}

function columnMean(timeline: Timeline, column: string): number {
  if (!timeline.hasColumn(column) || timeline.length === 0) return NaN
  let sum = 0
  let n = 0
  for (let i = 0; i < timeline.length; i++) {
    const value = timeline.get(column, i)
    if (Number.isFinite(value)) {
      sum += value
      n++
    }
  }
  return n === 0 ? NaN : sum / n
}

function lastFinite(timeline: Timeline, column: string): number {
  if (!timeline.hasColumn(column) || timeline.length === 0) return NaN
  for (let i = timeline.length - 1; i >= 0; i--) {
    const value = timeline.get(column, i)
    if (Number.isFinite(value)) return value
  }
  return NaN
}

function countFinite(timeline: Timeline, column: string): number {
  if (!timeline.hasColumn(column)) return 0
  let n = 0
  for (let i = 0; i < timeline.length; i++) {
    if (Number.isFinite(timeline.get(column, i))) n++
  }
  return n
}
