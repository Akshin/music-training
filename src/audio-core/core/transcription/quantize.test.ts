import { describe, expect, it } from 'vitest'

import { level } from '../analysis/extractors/level'
import { pitch } from '../analysis/extractors/pitch'
import { analyzeOffline } from '../analysis/offline'
import { BeatGrid } from '../clock/beat-grid'
import { segmentTake } from '../segmentation/index'
import type { NoteSegment, NoteTransition, Slide } from '../segmentation/types'
import { noteSequence, seq, TEST_SAMPLE_RATE } from '../testing/signals'
import { quantizeNotes } from './quantize'

const C4 = 60
const D4 = 62
const E4 = 64
const G4 = 67

/** 120 BPM: a beat is 0.5 s, a sixteenth 0.125 s. */
const grid = new BeatGrid({ bpm: 120 })

function sung(
  start: number,
  end: number,
  midi: number,
  transition: NoteTransition = 'attack',
): NoteSegment {
  return {
    startFrame: Math.round(start * 100),
    endFrame: Math.round(end * 100),
    startTime: start,
    endTime: end,
    duration: end - start,
    phrase: 0,
    midi,
    note: Math.round(midi),
    cents: (midi - Math.round(midi)) * 100,
    spreadCents: 0,
    voicedFrames: Math.round((end - start) * 100),
    transition,
  }
}

function slide(fromNote: number, toNote: number, start: number, end: number): Slide {
  return {
    startFrame: Math.round(start * 100),
    endFrame: Math.round(end * 100),
    startTime: start,
    endTime: end,
    duration: end - start,
    phrase: 0,
    fromMidi: 0,
    toMidi: 0,
    fromNote,
    toNote,
  }
}

describe('quantizeNotes', () => {
  it('snaps onsets and lengths to sixteenths and tunes the pitch', () => {
    const { notes, dropped } = quantizeNotes(
      [sung(0.03, 0.47, 60.3), sung(0.52, 0.98, 61.8), sung(1.24, 1.4, 64.1)],
      [],
      grid,
    )
    expect(notes.map((n) => [n.midi, n.startStep, n.steps])).toEqual([
      [C4, 0, 4],
      [D4, 4, 4],
      [E4, 10, 1],
    ])
    expect(notes[0]).toMatchObject({ startBeat: 0, durationBeats: 1, source: 0 })
    expect(notes[0].offsetSeconds).toBeCloseTo(0.03)
    expect(notes[2].offsetSeconds).toBeCloseTo(-0.01)
    expect(dropped).toEqual([])
  })

  it('keeps the sung pitch when not asked to tune', () => {
    const { notes } = quantizeNotes([sung(0, 0.5, 60.3)], [], grid, { tune: false })
    expect(notes[0].midi).toBeCloseTo(60.3)
  })

  it('subtracts the latency before snapping', () => {
    const late = [sung(0.2, 0.7, C4), sung(0.7, 1.2, D4)]
    expect(quantizeNotes(late, [], grid).notes.map((n) => n.startStep)).toEqual([2, 6])
    const fixed = quantizeNotes(late, [], grid, { latencySeconds: 0.2 })
    expect(fixed.notes.map((n) => n.startStep)).toEqual([0, 4])
  })

  it('takes the step from the options and the tempo from the grid', () => {
    const eighths = quantizeNotes([sung(0.27, 0.74, C4)], [], grid, { stepBeats: 0.5 })
    expect(eighths.notes[0]).toMatchObject({ startStep: 1, steps: 2, startBeat: 0.5 })
    const slow = quantizeNotes([sung(1, 2, C4)], [], new BeatGrid({ bpm: 60 }))
    expect(slow.notes[0]).toMatchObject({ startStep: 4, steps: 4 })
    expect(() => quantizeNotes([], [], grid, { stepBeats: 0 })).toThrow(RangeError)
  })

  it('gives every note at least a step and cuts it where the next begins', () => {
    const { notes } = quantizeNotes(
      [sung(0, 0.04, C4), sung(0.25, 1.2, D4), sung(0.5, 0.9, E4)],
      [],
      grid,
    )
    expect(notes.map((n) => [n.startStep, n.steps])).toEqual([
      [0, 1],
      [2, 2],
      [4, 3],
    ])
  })

  it('holds a note up to the next one when that is entered legato', () => {
    // The step between the notes is smeared: the first stops sounding 90 ms before the second.
    const { notes } = quantizeNotes(
      [sung(0, 0.41, C4), sung(0.5, 1, D4, 'legato'), sung(1.09, 1.5, E4, 'gap')],
      [],
      grid,
    )
    expect(notes.map((n) => [n.startStep, n.steps])).toEqual([
      [0, 4],
      [4, 4],
      [9, 3],
    ])
  })

  it('marks a note that a slide carries straight into the next', () => {
    const notes = [sung(0, 0.5, C4), sung(0.75, 1.25, G4, 'slide'), sung(1.5, 2, C4)]
    const result = quantizeNotes(notes, [slide(0, 1, 0.5, 0.75)], grid)
    expect(result.notes.map((n) => [n.startStep, n.steps, n.slideTo])).toEqual([
      [0, 6, G4],
      [6, 4, undefined],
      [12, 4, undefined],
    ])
  })

  it('ignores slides into silence and from nowhere', () => {
    const result = quantizeNotes(
      [sung(0.1, 0.5, C4, 'slide'), sung(1, 1.5, D4)],
      [{ ...slide(-1, 0, 0, 0.1) }, { ...slide(1, 2, 1.5, 1.7), toNote: undefined }],
      grid,
    )
    expect(result.notes.map((n) => n.slideTo)).toEqual([undefined, undefined])
  })

  it('keeps the longer of two notes on one step and reports the other', () => {
    // A grace note before the beat, then a turn squeezed into one sixteenth.
    const result = quantizeNotes(
      [
        sung(-0.05, 0.01, D4),
        sung(0.01, 0.5, C4, 'legato'),
        sung(0.5, 0.56, D4, 'legato'),
        sung(0.56, 0.6, E4, 'legato'),
        sung(0.62, 1, D4, 'legato'),
      ],
      [],
      grid,
    )
    expect(result.notes.map((n) => [n.midi, n.startStep, n.steps])).toEqual([
      [C4, 0, 4],
      [D4, 4, 1],
      [D4, 5, 3],
    ])
    expect(result.dropped).toEqual([0, 3])
  })

  it('keeps only the notes of the asked beats and cuts the last at their end', () => {
    const notes = [sung(1.9, 2.4, C4), sung(2.02, 2.5, D4), sung(3, 4.6, E4), sung(4.02, 4.5, G4)]
    const result = quantizeNotes(notes, [], grid, { fromBeat: 4, toBeat: 8 })
    // The first snaps to the last sixteenth of the bar before; the last to the bar after.
    expect(result.notes.map((n) => [n.midi, n.startStep, n.steps])).toEqual([
      [D4, 16, 4],
      [E4, 24, 8],
    ])
    expect(result.dropped).toEqual([])
  })
})

describe('quantizeNotes on a synthesised take', () => {
  function transcribe(signal: { samples: Float32Array }, bpm: number, latencySeconds = 0) {
    const { timeline } = analyzeOffline(signal.samples, { sampleRate: TEST_SAMPLE_RATE }, [
      pitch,
      level,
    ])
    const { notes, slides } = segmentTake(timeline)
    return quantizeNotes(notes, slides, new BeatGrid({ bpm }), { latencySeconds })
  }

  it('reads quarters, eighths and a rest sung to a 90 BPM click', () => {
    const beat = 60 / 90
    const signal = noteSequence([
      seq.note(C4, beat * 0.9),
      seq.pause(beat * 0.1),
      seq.note(D4, beat * 0.9),
      seq.pause(beat * 0.1),
      seq.note(E4, beat / 2),
      seq.note(D4, beat / 2),
      seq.pause(beat),
      seq.note(C4, beat * 2),
    ])
    const { notes, dropped } = transcribe(signal, 90)
    expect(notes.map((n) => [n.midi, n.startStep, n.steps])).toEqual([
      [C4, 0, 4],
      [D4, 4, 4],
      [E4, 8, 2],
      [D4, 10, 2],
      [C4, 16, 8],
    ])
    expect(dropped).toEqual([])
    for (const note of notes) expect(Math.abs(note.offsetSeconds)).toBeLessThan(0.05)
  })

  it('reads a portamento as a note that slides into the next', () => {
    const signal = noteSequence([
      seq.note(C4, 0.5),
      seq.slide(C4, G4, 0.5),
      seq.note(G4, 1),
      seq.pause(0.3),
    ])
    const { notes } = transcribe(signal, 120)
    expect(notes.map((n) => [n.midi, n.startStep, n.steps, n.slideTo])).toEqual([
      [C4, 0, 8, G4],
      [G4, 8, 8, undefined],
    ])
  })

  it('lands on the grid again once the latency is taken off', () => {
    const beat = 0.5
    const signal = noteSequence([
      seq.pause(0.18),
      seq.note(C4, beat),
      seq.note(E4, beat),
      seq.note(G4, beat),
      seq.pause(0.2),
    ])
    expect(transcribe(signal, 120, 0.18).notes.map((n) => [n.midi, n.startStep])).toEqual([
      [C4, 0],
      [E4, 4],
      [G4, 8],
    ])
  })
})
