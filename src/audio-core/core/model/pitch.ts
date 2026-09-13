/**
 * Conversions between frequency, MIDI pitch and cents.
 *
 * All functions propagate NaN, so an unvoiced frame (f0 = NaN) stays NaN through the chain.
 */

export const DEFAULT_A4 = 440
export const A4_MIDI = 69

export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const

/** Frequency → fractional MIDI pitch (69 = A4). */
export function hzToMidi(hz: number, a4 = DEFAULT_A4): number {
  return A4_MIDI + 12 * Math.log2(hz / a4)
}

/** Fractional MIDI pitch → frequency. */
export function midiToHz(midi: number, a4 = DEFAULT_A4): number {
  return a4 * 2 ** ((midi - A4_MIDI) / 12)
}

/** Signed distance from `referenceHz` to `hz` in cents (1200 per octave). */
export function centsBetween(hz: number, referenceHz: number): number {
  return 1200 * Math.log2(hz / referenceHz)
}

/** Nearest integer MIDI note for a fractional pitch. */
export function nearestMidi(midi: number): number {
  return Math.round(midi)
}

/** Deviation of a fractional pitch from its nearest note, in cents, within [-50, 50]. */
export function centsOffNearest(midi: number): number {
  return (midi - Math.round(midi)) * 100
}

/** Scientific pitch name for an integer MIDI note, e.g. 69 → "A4". Fractions are rounded. */
export function noteName(midi: number): string {
  const rounded = Math.round(midi)
  const name = NOTE_NAMES[((rounded % 12) + 12) % 12]
  const octave = Math.floor(rounded / 12) - 1
  return `${name}${octave}`
}
