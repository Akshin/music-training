/**
 * Loudness (LUFS) from a K-weighted mean-square, ITU-R BS.1770-4 / EBU R128.
 *
 * Mono channel weight is 1. The −0.691 dB offset is part of the Recommendation (it is *not*
 * optional for stereo). Momentary = 400 ms ungated; short-term = 3 s ungated. Absolute gate
 * (−70 LUFS) is applied only to the integrated mean.
 */

/** Mean-square → LUFS, mono. */
export const LUFS_OFFSET = -0.691
export const LUFS_ABSOLUTE_GATE = -70
/** Relative gate is this many LU below the absolute-gated loudness (EBU R128). */
export const LUFS_RELATIVE_GATE = 10
export const MOMENTARY_SECONDS = 0.4
export const SHORT_TERM_SECONDS = 3
export const GATE_BLOCK_SECONDS = 0.4
export const GATE_HOP_SECONDS = 0.1

export function meanSquareToLufs(meanSquare: number): number {
  if (!(meanSquare > 0)) return -Infinity
  return LUFS_OFFSET + 10 * Math.log10(meanSquare)
}

export function lufsToMeanSquare(lufs: number): number {
  if (!Number.isFinite(lufs)) return 0
  return 10 ** ((lufs - LUFS_OFFSET) / 10)
}

/** Mean of block loudness values after the −70 LUFS absolute gate. */
export function gatedIntegrated(blockLufs: ArrayLike<number>, count: number): number {
  let sum = 0
  let n = 0
  for (let i = 0; i < count; i++) {
    const value = blockLufs[i]
    if (value >= LUFS_ABSOLUTE_GATE) {
      sum += lufsToMeanSquare(value)
      n++
    }
  }
  return n === 0 ? -Infinity : meanSquareToLufs(sum / n)
}

/**
 * EBU R128 integrated: absolute gate −70, then relative gate at `L − 10` LU.
 * Quiet tails that passed −70 but sit more than 10 LU below the programme are dropped.
 */
export function relativeGated(blockLufs: ArrayLike<number>, count: number): number {
  const absolute = gatedIntegrated(blockLufs, count)
  if (!Number.isFinite(absolute)) return -Infinity
  const rel = absolute - LUFS_RELATIVE_GATE
  let sum = 0
  let n = 0
  for (let i = 0; i < count; i++) {
    const value = blockLufs[i]
    if (value >= LUFS_ABSOLUTE_GATE && value >= rel) {
      sum += lufsToMeanSquare(value)
      n++
    }
  }
  return n === 0 ? -Infinity : meanSquareToLufs(sum / n)
}
