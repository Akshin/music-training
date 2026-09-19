import { onBeforeUnmount, onMounted } from 'vue'
import { PAD_KEYS } from '@/training/builder'

export interface BuilderKeyActions {
  /** A piano key on the home row: pitch class, C = 0. */
  readonly note: (pitchClass: number) => void
  readonly rest: () => void
  readonly inhale: () => void
  readonly exhale: () => void
  readonly undo: () => void
  readonly octave: (by: number) => void
  /** Digits 1–5: the listed lengths, whole note first. */
  readonly length: (n: number) => void
}

const PAD_CODES = PAD_KEYS.map((key) => `Key${key.toUpperCase()}`)

/**
 * The builder's keyboard: a piano on the home row (A W S E D F T G Y H U J), Z/X for the octave,
 * R a rest, V an inhale, B an exhale, Backspace undo, 1–5 the length. Keys are matched by position
 * (`code`), so they work in any layout; text fields keep their letters.
 */
export function useBuilderKeys(actions: BuilderKeyActions) {
  function onKeydown(event: KeyboardEvent): void {
    if (event.metaKey || event.ctrlKey || event.altKey || event.repeat) return
    const target = event.target
    if (
      target instanceof Element &&
      target.closest('input[type="text"], textarea, select, [contenteditable="true"]')
    ) {
      return
    }
    const pitchClass = PAD_CODES.indexOf(event.code)
    if (pitchClass >= 0) actions.note(pitchClass)
    else if (event.code === 'KeyZ') actions.octave(-1)
    else if (event.code === 'KeyX') actions.octave(1)
    else if (event.code === 'KeyR') actions.rest()
    else if (event.code === 'KeyV') actions.inhale()
    else if (event.code === 'KeyB') actions.exhale()
    else if (event.code === 'Backspace') actions.undo()
    else if (/^Digit[1-5]$/.test(event.code)) actions.length(Number(event.code.slice(5)))
    else return
    event.preventDefault()
  }

  onMounted(() => window.addEventListener('keydown', onKeydown))
  onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
}
