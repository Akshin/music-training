import { onScopeDispose, ref, watch } from 'vue'
import type { BuilderDraft } from '@/composables/useBuilderDraft'
import {
  longestFitting,
  NOTE_LENGTH_DEFAULT,
  NOTE_LENGTHS,
  OCTAVE_DEFAULT,
  OCTAVE_MAX,
  OCTAVE_MIN,
  type BarElement,
  type ElementType,
  type NoteKind,
} from '@/training/builder'

/** The key of the note just added stays lit this long, ms. */
const FLASH_MS = 180

/**
 * The pen of the builder: the length and the kind the next element gets, the octave the keys play
 * in, and the key just pressed. It shapes elements; the draft decides whether they fit.
 */
export function useNoteEntry(builder: BuilderDraft) {
  const length = ref(NOTE_LENGTH_DEFAULT)
  const kind = ref<NoteKind>('hold')
  const octave = ref(OCTAVE_DEFAULT)
  /** The key the last note came from, lit for a moment. */
  const flash = ref<number | null>(null)
  let flashTimer = 0

  // After an element, the chosen length may no longer fit: fall back to the longest that does.
  watch([builder.current, builder.beats], () => {
    if (builder.canAdd(length.value)) return
    length.value = longestFitting(builder.current.value, builder.beats.value) ?? NOTE_LENGTH_DEFAULT
  })

  /** A note of the pitch class `pitchClass` (C = 0) in the current octave. */
  function noteAt(pitchClass: number): BarElement {
    return {
      type: 'note',
      midi: (octave.value + 1) * 12 + pitchClass,
      kind: kind.value,
      sixteenths: length.value,
    }
  }

  /** An element of the current length: a note of `midi`, or one with no pitch. */
  function element(type: ElementType, midi?: number): BarElement {
    if (type === 'note') {
      return { type, midi: midi ?? 60, kind: kind.value, sixteenths: length.value }
    }
    return { type, sixteenths: length.value }
  }

  function lightKey(midi: number): void {
    flash.value = midi
    window.clearTimeout(flashTimer)
    flashTimer = window.setTimeout(() => (flash.value = null), FLASH_MS)
  }

  function shiftOctave(by: number): void {
    octave.value = Math.min(OCTAVE_MAX, Math.max(OCTAVE_MIN, octave.value + by))
  }

  /** Picks the `n`-th listed length (1 = whole note) if it still fits. */
  function pickLength(n: number): void {
    const option = NOTE_LENGTHS[n - 1]
    if (option && builder.canAdd(option.sixteenths)) length.value = option.sixteenths
  }

  onScopeDispose(() => window.clearTimeout(flashTimer))

  return { length, kind, octave, flash, noteAt, element, lightKey, shiftOctave, pickLength }
}

export type NoteEntry = ReturnType<typeof useNoteEntry>
