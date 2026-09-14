/** Meter input clamped to [0, 1]; anything that is not a finite number reads as silence. */
export function clampLevel(value: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0
}
