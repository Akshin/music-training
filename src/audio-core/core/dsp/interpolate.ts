/**
 * Parabolic interpolation through three equally spaced samples (−1, a), (0, b), (1, c).
 * Used to refine the position of a peak or a dip found on a discrete grid.
 */

/** Offset of the parabola's vertex from the centre sample, clamped to [−0.5, 0.5]. */
export function parabolicOffset(a: number, b: number, c: number): number {
  const denominator = a - 2 * b + c
  if (denominator === 0) return 0
  const offset = (0.5 * (a - c)) / denominator
  return offset > 0.5 ? 0.5 : offset < -0.5 ? -0.5 : offset
}

/** Value of the parabola at the given vertex offset. */
export function parabolicValue(a: number, b: number, c: number, offset: number): number {
  return b - 0.25 * (a - c) * offset
}

/** Normalized sinc: `sin(πx) / (πx)`, 1 at 0. */
export function sinc(x: number): number {
  if (x === 0) return 1
  const px = Math.PI * x
  return Math.sin(px) / px
}
