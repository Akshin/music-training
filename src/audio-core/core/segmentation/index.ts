import type { Timeline } from '../model/timeline'
import type { MauchOptions } from './mauch'
import { transcribeNotes } from './mauch'
import { segmentNotes, type NoteOptions } from './notes'
import { segmentPhrases, type PhraseOptions } from './phrases'
import type { NoteSegment, Phrase, Slide, TakeSegmentation } from './types'

export interface SegmentationOptions {
  readonly phrases?: PhraseOptions
  readonly notes?: NoteOptions
  /**
   * `greedy` (default) is the live contour walker with slides. `mauch` is the Tony-style HMM;
   * it does not emit slides.
   */
  readonly method?: 'greedy' | 'mauch'
  readonly mauch?: MauchOptions
}

function phraseIndex(phrases: readonly Phrase[], startFrame: number): number {
  for (let i = 0; i < phrases.length; i++) {
    const phrase = phrases[i]
    if (startFrame >= phrase.startFrame && startFrame < phrase.endFrame) return i
  }
  return -1
}

function attachPhrases(notes: readonly NoteSegment[], phrases: readonly Phrase[]): NoteSegment[] {
  const seen = new Set<number>()
  const attached: NoteSegment[] = []
  for (const note of notes) {
    const phrase = phraseIndex(phrases, note.startFrame)
    if (phrase < 0) continue
    const firstInPhrase = !seen.has(phrase)
    seen.add(phrase)
    attached.push({
      ...note,
      phrase,
      transition: firstInPhrase ? 'attack' : note.transition,
    })
  }
  return attached
}

/** Phrases → notes and slides over `[startFrame, endFrame)` of a timeline. */
export function segmentTake(
  timeline: Timeline,
  startFrame = 0,
  endFrame = timeline.length,
  options: SegmentationOptions = {},
): TakeSegmentation {
  const { phrases, gateDb, noiseFloorDb } = segmentPhrases(
    timeline,
    startFrame,
    endFrame,
    options.phrases,
  )
  if (options.method === 'mauch') {
    const raw = transcribeNotes(timeline, startFrame, endFrame, options.mauch)
    return { phrases, notes: attachPhrases(raw, phrases), slides: [], gateDb, noiseFloorDb }
  }
  const notes: NoteSegment[] = []
  const slides: Slide[] = []
  phrases.forEach((phrase, index) => {
    const result = segmentNotes(timeline, phrase, index, options.notes)
    const offset = notes.length
    notes.push(...result.notes)
    for (const slide of result.slides) {
      slides.push({
        ...slide,
        fromNote: slide.fromNote < 0 ? -1 : slide.fromNote + offset,
        toNote: slide.toNote === undefined ? undefined : slide.toNote + offset,
      })
    }
  })
  return { phrases, notes, slides, gateDb, noiseFloorDb }
}

export type { NoteOptions } from './notes'
export { median, medianFilterVoiced, segmentNotes } from './notes'
export type { PhraseOptions, PhraseSegmentation } from './phrases'
export { percentile, runsOf, segmentPhrases } from './phrases'
export type { MauchOptions } from './mauch'
export { transcribeNotes } from './mauch'
export type { GestureOptions, NoteGesture, PitchGesture } from './gestures'
export { classifyGestures } from './gestures'
export type {
  FrameSpan,
  NoteSegment,
  NoteTransition,
  Phrase,
  Slide,
  TakeSegmentation,
} from './types'
