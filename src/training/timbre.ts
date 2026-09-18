/**
 * Timbre of the voice through its first three harmonics: how loud the second («полнота») and the
 * third («звон») are against the first («основа»). A mix that goes hollow loses H3 first.
 */

/** Levels of the first three harmonics of the voice, dBFS. */
export interface Timbre {
  readonly h1: number
  readonly h2: number
  readonly h3: number
}

/** Loudness of H2 and H3 relative to H1, dB; 0 is as loud as the fundamental. */
export interface HarmonicRatios {
  readonly h2: number
  readonly h3: number
}

/**
 * Ratios the voice should keep, dB. A starting point from full chest voice; a trained mix keeps
 * roughly these, a hollow one drops H3 by 15 dB or more.
 */
export const TIMBRE_TARGET: HarmonicRatios = { h2: -8, h3: -12 }

/** How far below the target a ratio still earns partial success, dB. */
const SUCCESS_SOFTNESS_DB = 8
/** A ratio this far below H1 draws as a still, hairline string. */
const STRING_FLOOR_DB = -30

export function harmonicRatios(timbre: Timbre): HarmonicRatios {
  return { h2: timbre.h2 - timbre.h1, h3: timbre.h3 - timbre.h1 }
}

/**
 * How close the ratios are to the target, 0–1: the weaker of the two, 1 once both reach it and
 * falling to 0 `SUCCESS_SOFTNESS_DB` below it.
 */
export function timbreSuccess(ratios: HarmonicRatios, target = TIMBRE_TARGET): number {
  const reach = (ratio: number, goal: number) =>
    clamp01((ratio - goal + SUCCESS_SOFTNESS_DB) / SUCCESS_SOFTNESS_DB)
  return Math.min(reach(ratios.h2, target.h2), reach(ratios.h3, target.h3))
}

/** Harmonics below their target, 2 and/or 3 — what to ask the singer for. */
export function lackingHarmonics(ratios: HarmonicRatios, target = TIMBRE_TARGET): (2 | 3)[] {
  const lacking: (2 | 3)[] = []
  if (ratios.h2 < target.h2) lacking.push(2)
  if (ratios.h3 < target.h3) lacking.push(3)
  return lacking
}

/**
 * Strength of each string, 0–1, for `HarmonicStrings`: the fundamental follows the voice's
 * loudness, the upper two scale it by their ratio on a dB scale down to `STRING_FLOOR_DB`.
 */
export function stringStrengths(
  ratios: HarmonicRatios | null,
  loudness: number,
): [number, number, number] {
  if (ratios === null) return [0, 0, 0]
  const strength = (ratio: number) => loudness * clamp01(1 - ratio / STRING_FLOOR_DB)
  return [clamp01(loudness), strength(ratios.h2), strength(ratios.h3)]
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value))
}
