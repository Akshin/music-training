/**
 * Sung notes as bars of the builder. The engine puts what was sung on a grid of sixteenths
 * (`quantizeNotes`); this fits it into what a bar can hold. A bar has no ties and five lengths, so:
 * a note that runs over the bar line ends at it, a note of a length a bar cannot write (a dotted
 * one, say) keeps its onset and the longest length that fits, and what is left of it is a rest. The
 * onsets — what a run of the training is judged by — stay exactly where they were sung.
 */
import type { GridNote } from '@audio-core/core/index'
import {
  NOTE_LENGTHS,
  barCapacity,
  sixteenthsPerBeat,
  type BarElement,
  type NoteKind,
} from '@/training/builder'

/** The grid step that makes a step a sixteenth, in beats of the meter. */
export function sixteenthBeats(beats: number): number {
  return 1 / sixteenthsPerBeat(beats)
}

/** The longest length a bar can write that is no longer than `sixteenths`. */
function writable(sixteenths: number): number {
  return NOTE_LENGTHS.find((option) => option.sixteenths <= sixteenths)?.sixteenths ?? 1
}

/** Rests over `[from, to)` of a bar, each as long as its place in the bar allows. */
function rests(from: number, to: number): BarElement[] {
  const elements: BarElement[] = []
  let at = from
  while (at < to) {
    const length =
      NOTE_LENGTHS.find((option) => option.sixteenths <= to - at && at % option.sixteenths === 0)
        ?.sixteenths ?? 1
    elements.push({ type: 'rest', sixteenths: length })
    at += length
  }
  return elements
}

/**
 * Bars of the meter filled from notes on a grid of sixteenths, `firstStep` being the first
 * sixteenth of the first bar. Empty bars before the first note and after the last are left out;
 * notes before `firstStep` are ignored. A note keeps its glide into the next one only when it is
 * written at its full length, so the next note really follows it.
 */
export function barsFromSung(
  notes: readonly GridNote[],
  beats: number,
  firstStep = 0,
): BarElement[][] {
  const capacity = barCapacity(beats)
  const byBar = new Map<number, GridNote[]>()
  for (const note of notes) {
    if (note.startStep < firstStep) continue
    const bar = Math.floor((note.startStep - firstStep) / capacity)
    byBar.set(bar, [...(byBar.get(bar) ?? []), note])
  }
  if (byBar.size === 0) return []
  const first = Math.min(...byBar.keys())
  const last = Math.max(...byBar.keys())

  const bars: BarElement[][] = []
  for (let bar = first; bar <= last; bar++) {
    const start = firstStep + bar * capacity
    const elements: BarElement[] = []
    let at = 0
    for (const note of byBar.get(bar) ?? []) {
      const offset = note.startStep - start
      if (offset < at) continue
      elements.push(...rests(at, offset))
      const length = writable(Math.min(note.steps, capacity - offset))
      const kind: NoteKind = note.slideTo !== undefined && length === note.steps ? 'slide' : 'hold'
      elements.push({ type: 'note', midi: Math.round(note.midi), kind, sixteenths: length })
      at = offset + length
    }
    elements.push(...rests(at, capacity))
    bars.push(elements)
  }
  return bars
}
