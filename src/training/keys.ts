/** The twelve tonal centres, named with sharps as the backing tracks are. */
export const TONAL_KEYS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const

export type TonalKey = (typeof TONAL_KEYS)[number]

export const TONAL_KEY_DEFAULT: TonalKey = 'C'

/** Pitch class of the key: C = 0 … B = 11. */
export function keyPitchClass(key: TonalKey): number {
  return TONAL_KEYS.indexOf(key)
}

/** Scientific pitch name of a MIDI note: 60 → C4, 61 → C#4. */
export function noteName(midi: number): string {
  const pitchClass = ((Math.round(midi) % 12) + 12) % 12
  return `${TONAL_KEYS[pitchClass]}${Math.floor(Math.round(midi) / 12) - 1}`
}

/** MIDI tonic C4–B4, so a scale up to the octave still ends below C6. */
export function keyTonicMidi(key: TonalKey): number {
  return 60 + keyPitchClass(key)
}
