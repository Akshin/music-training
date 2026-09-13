/** Shared tempo limits (Maelzel metronome range). */
export const BPM_MIN = 40
export const BPM_MAX = 208
export const BPM_DEFAULT = 80

/** Beats per measure (numerator of the time signature). */
export const BEATS_MIN = 2
export const BEATS_MAX = 6
export const BEATS_DEFAULT = 4

export type TimeSignatureOption = {
  label: string
  beats: number
}

/** Common practice meters for the transport. */
export const TIME_SIGNATURES: readonly TimeSignatureOption[] = [
  { label: '2/4', beats: 2 },
  { label: '3/4', beats: 3 },
  { label: '4/4', beats: 4 },
  { label: '5/4', beats: 5 },
  { label: '6/8', beats: 6 },
] as const

export function clampBpm(value: number, fallback = BPM_DEFAULT): number {
  if (!Number.isFinite(value)) return fallback
  return Math.min(BPM_MAX, Math.max(BPM_MIN, Math.round(value)))
}

export function clampBeats(value: number, fallback = BEATS_DEFAULT): number {
  if (!Number.isFinite(value)) return fallback
  return Math.min(BEATS_MAX, Math.max(BEATS_MIN, Math.round(value)))
}

export function secondsPerBeat(bpm: number): number {
  return 60 / Math.max(1, bpm)
}
