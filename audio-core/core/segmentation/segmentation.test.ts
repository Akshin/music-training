import { describe, expect, it } from 'vitest'

import { level } from '../analysis/extractors/level'
import { pitch } from '../analysis/extractors/pitch'
import { analyzeOffline } from '../analysis/offline'
import { Timeline } from '../model/timeline'
import { noteSequence, seq, TEST_SAMPLE_RATE } from '../testing/signals'
import {
  classifyGestures,
  medianFilterVoiced,
  segmentNotes,
  segmentPhrases,
  segmentTake,
} from './index'

const C4 = 60
const D4 = 62
const E4 = 64
const F4 = 65
const G4 = 67
const A3 = 57

function analyse(signal: { samples: Float32Array }) {
  return analyzeOffline(signal.samples, { sampleRate: TEST_SAMPLE_RATE }, [pitch, level]).timeline
}

/** Timeline with hand-written columns, 100 frames/s. */
function manualTimeline(frames: number): Timeline {
  const timeline = new Timeline({
    sampleRate: TEST_SAMPLE_RATE,
    hopSize: 480,
    originSample: 1024,
    columns: ['midi', 'f0Confidence', 'dbfs'],
  })
  const midi = new Float32Array(frames).fill(NaN)
  const confidence = new Float32Array(frames)
  const dbfs = new Float32Array(frames).fill(-90)
  timeline.appendBatch(frames, { midi, f0Confidence: confidence, dbfs })
  return timeline
}

function paint(
  timeline: Timeline,
  from: number,
  to: number,
  values: { midi?: number; confidence?: number; dbfs?: number },
): void {
  for (let i = from; i < to; i++) {
    if (values.midi !== undefined) timeline.set('midi', i, values.midi)
    if (values.confidence !== undefined) timeline.set('f0Confidence', i, values.confidence)
    if (values.dbfs !== undefined) timeline.set('dbfs', i, values.dbfs)
  }
}

describe('segmentPhrases', () => {
  it('finds sounds between pauses with an adaptive gate', () => {
    const timeline = manualTimeline(400)
    paint(timeline, 50, 150, { dbfs: -20, midi: 60, confidence: 0.9 })
    paint(timeline, 200, 350, { dbfs: -25, midi: 62, confidence: 0.9 })
    const { phrases, gateDb, noiseFloorDb } = segmentPhrases(timeline)
    expect(noiseFloorDb).toBe(-90)
    expect(gateDb).toBe(-65)
    expect(phrases.map((p) => [p.startFrame, p.endFrame])).toEqual([
      [50, 150],
      [200, 350],
    ])
    expect(phrases[0].peakDb).toBe(-20)
    expect(phrases[0].voicedRatio).toBe(1)
    expect(phrases[0].startTime).toBeCloseTo(timeline.frameTime(50), 9)
    expect(phrases[0].duration).toBeCloseTo(1.0, 9)
  })

  it('bridges pauses shorter than minPause and drops blips shorter than minPhrase', () => {
    const timeline = manualTimeline(400)
    paint(timeline, 50, 150, { dbfs: -20 })
    paint(timeline, 160, 250, { dbfs: -20 }) // 100 ms gap → bridged
    paint(timeline, 300, 305, { dbfs: -20 }) // 50 ms blip → dropped
    const { phrases } = segmentPhrases(timeline)
    expect(phrases.map((p) => [p.startFrame, p.endFrame])).toEqual([[50, 250]])
  })

  it('respects a fixed gate and a frame range', () => {
    const timeline = manualTimeline(300)
    paint(timeline, 0, 300, { dbfs: -40 })
    paint(timeline, 100, 200, { dbfs: -10 })
    expect(segmentPhrases(timeline, 0, 300, { gateDb: -30 }).phrases).toHaveLength(1)
    expect(segmentPhrases(timeline, 0, 300, { gateDb: -50 }).phrases).toHaveLength(1)
    expect(segmentPhrases(timeline, 0, 300, { gateDb: -50 }).phrases[0].endFrame).toBe(300)
    expect(segmentPhrases(timeline, 120, 180, { gateDb: -30 }).phrases[0]).toMatchObject({
      startFrame: 120,
      endFrame: 180,
    })
  })

  it('returns nothing for an empty or silent range', () => {
    const timeline = manualTimeline(100)
    expect(segmentPhrases(timeline).phrases).toEqual([])
    expect(segmentPhrases(timeline, 50, 50).phrases).toEqual([])
  })
})

describe('medianFilterVoiced', () => {
  it('removes short blips and keeps NaN where unvoiced', () => {
    const contour = new Float32Array([60, 60, 72, 60, 60, NaN, NaN, 62, 62, 62])
    const filtered = medianFilterVoiced(contour, 5)
    expect(Array.from(filtered.subarray(0, 5))).toEqual([60, 60, 60, 60, 60])
    expect(filtered[5]).toBeNaN()
    expect(filtered[6]).toBeNaN()
    expect(Array.from(filtered.subarray(7))).toEqual([62, 62, 62])
  })
})

describe('segmentNotes on hand-made contours', () => {
  const phraseOf = (timeline: Timeline, startFrame: number, endFrame: number) => ({
    startFrame,
    endFrame,
    startTime: timeline.frameTime(startFrame),
    endTime: timeline.frameTime(endFrame),
    duration: timeline.frameTime(endFrame) - timeline.frameTime(startFrame),
    peakDb: -20,
    meanDb: -20,
    voicedRatio: 1,
  })

  it('ignores an octave blip inside a note', () => {
    const timeline = manualTimeline(120)
    paint(timeline, 10, 110, { dbfs: -20, midi: 60, confidence: 0.9 })
    paint(timeline, 60, 62, { midi: 72 })
    const { notes, slides } = segmentNotes(timeline, phraseOf(timeline, 10, 110), 0)
    expect(notes).toHaveLength(1)
    expect(notes[0]).toMatchObject({
      startFrame: 10,
      endFrame: 110,
      note: 60,
      transition: 'attack',
    })
    expect(notes[0].cents).toBe(0)
    expect(slides).toEqual([])
  })

  it('bridges a short unvoiced gap when the pitch resumes on centre', () => {
    const timeline = manualTimeline(120)
    paint(timeline, 10, 110, { dbfs: -20, midi: 64, confidence: 0.9 })
    paint(timeline, 50, 58, { confidence: 0.1 }) // 80 ms consonant
    const { notes } = segmentNotes(timeline, phraseOf(timeline, 10, 110), 0)
    expect(notes).toHaveLength(1)
    expect(notes[0]).toMatchObject({ startFrame: 10, endFrame: 110, note: 64 })
    expect(notes[0].voicedFrames).toBe(92)
  })

  it('starts a new note after a gap when the pitch changes', () => {
    const timeline = manualTimeline(120)
    paint(timeline, 10, 50, { dbfs: -20, midi: 64, confidence: 0.9 })
    paint(timeline, 58, 110, { dbfs: -20, midi: 67, confidence: 0.9 })
    paint(timeline, 50, 58, { dbfs: -20, confidence: 0.1 })
    const { notes } = segmentNotes(timeline, phraseOf(timeline, 10, 110), 0)
    expect(notes.map((n) => [n.note, n.transition])).toEqual([
      [64, 'attack'],
      [67, 'gap'],
    ])
  })

  it('splits a step into two notes with a legato transition', () => {
    const timeline = manualTimeline(120)
    paint(timeline, 10, 60, { dbfs: -20, midi: 60, confidence: 0.9 })
    paint(timeline, 60, 110, { dbfs: -20, midi: 62, confidence: 0.9 })
    const { notes, slides } = segmentNotes(timeline, phraseOf(timeline, 10, 110), 0)
    expect(notes.map((n) => [n.startFrame, n.endFrame, n.note, n.transition])).toEqual([
      [10, 60, 60, 'attack'],
      [60, 110, 62, 'legato'],
    ])
    expect(slides).toEqual([])
  })

  it('treats a wide vibrato as one note and reports its spread', () => {
    const timeline = manualTimeline(220)
    for (let i = 10; i < 210; i++) {
      paint(timeline, i, i + 1, {
        dbfs: -20,
        confidence: 0.9,
        midi: 57 + 0.5 * Math.sin((2 * Math.PI * 6 * (i - 10)) / 100),
      })
    }
    const { notes, slides } = segmentNotes(timeline, phraseOf(timeline, 10, 210), 0)
    expect(notes).toHaveLength(1)
    expect(notes[0].note).toBe(57)
    expect(Math.abs(notes[0].cents)).toBeLessThan(5)
    expect(notes[0].spreadCents).toBeGreaterThan(25)
    expect(notes[0].spreadCents).toBeLessThan(45)
    expect(slides).toEqual([])
  })

  it('collapses a glide into a slide between two notes', () => {
    const timeline = manualTimeline(200)
    paint(timeline, 10, 60, { dbfs: -20, midi: 60, confidence: 0.9 })
    for (let i = 60; i < 100; i++) {
      paint(timeline, i, i + 1, { dbfs: -20, confidence: 0.9, midi: 60 + (7 * (i - 60)) / 40 })
    }
    paint(timeline, 100, 190, { dbfs: -20, midi: 67, confidence: 0.9 })
    const { notes, slides } = segmentNotes(timeline, phraseOf(timeline, 10, 190), 0)
    expect(notes.map((n) => [n.note, n.transition])).toEqual([
      [60, 'attack'],
      [67, 'slide'],
    ])
    expect(slides).toHaveLength(1)
    expect(slides[0]).toMatchObject({ fromNote: 0, toNote: 1 })
    expect(slides[0].fromMidi).toBeCloseTo(60, 1)
    expect(slides[0].toMidi).toBeCloseTo(67, 1)
    expect(slides[0].startFrame).toBeGreaterThanOrEqual(58)
    expect(slides[0].startFrame).toBeLessThanOrEqual(70)
    expect(slides[0].endFrame).toBeGreaterThanOrEqual(95)
    expect(slides[0].endFrame).toBeLessThanOrEqual(105)
    expect(notes[1].startFrame).toBe(slides[0].endFrame)
  })

  it('reports a fall-off at the end of a note as a slide into silence', () => {
    const timeline = manualTimeline(120)
    paint(timeline, 10, 80, { dbfs: -20, midi: 67, confidence: 0.9 })
    for (let i = 80; i < 100; i++) {
      paint(timeline, i, i + 1, { dbfs: -20, confidence: 0.9, midi: 67 - (5 * (i - 80)) / 20 })
    }
    const { notes, slides } = segmentNotes(timeline, phraseOf(timeline, 10, 100), 0)
    expect(notes).toHaveLength(1)
    expect(slides).toHaveLength(1)
    expect(slides[0].toNote).toBeUndefined()
    expect(slides[0].fromNote).toBe(0)
    expect(slides[0].toMidi).toBeLessThan(63)
  })

  it('keeps a fast run of short notes as notes, not a slide', () => {
    const timeline = manualTimeline(200)
    const run = [60, 62, 64, 65, 67, 69, 71, 72]
    run.forEach((midi, k) => {
      paint(timeline, 10 + k * 12, 10 + (k + 1) * 12, { dbfs: -20, midi, confidence: 0.9 })
    })
    const { notes, slides } = segmentNotes(timeline, phraseOf(timeline, 10, 106), 0)
    expect(notes.map((n) => n.note)).toEqual(run)
    expect(slides).toEqual([])
  })
})

describe('segmentTake on synthesised exercises', () => {
  it('separates five notes sung with pauses', () => {
    const signal = noteSequence([
      seq.pause(0.3),
      seq.note(C4, 0.5),
      seq.pause(0.4),
      seq.note(D4, 0.5),
      seq.pause(0.4),
      seq.note(E4, 0.5),
      seq.pause(0.4),
      seq.note(F4, 0.5),
      seq.pause(0.4),
      seq.note(G4, 0.5),
      seq.pause(0.3),
    ])
    const result = segmentTake(analyse(signal))
    expect(result.phrases).toHaveLength(5)
    expect(result.notes.map((n) => n.note)).toEqual([C4, D4, E4, F4, G4])
    expect(result.notes.every((n) => n.transition === 'attack')).toBe(true)
    expect(result.slides).toEqual([])

    const sung = signal.events.filter((e) => e.kind === 'note')
    result.phrases.forEach((phrase, i) => {
      expect(Math.abs(phrase.startTime - sung[i].start)).toBeLessThan(0.04)
      expect(Math.abs(phrase.endTime - sung[i].end)).toBeLessThan(0.04)
    })
    for (const note of result.notes) {
      expect(Math.abs(note.cents)).toBeLessThan(3)
      expect(note.spreadCents).toBeLessThan(3)
      expect(note.duration).toBeGreaterThan(0.4)
      expect(note.duration).toBeLessThan(0.55)
    }
  })

  it('splits a legato scale into notes without pauses', () => {
    const signal = noteSequence([
      seq.pause(0.2),
      seq.note(C4, 0.4),
      seq.note(D4, 0.4),
      seq.note(E4, 0.4),
      seq.note(F4, 0.4),
      seq.note(G4, 0.4),
      seq.pause(0.2),
    ])
    const result = segmentTake(analyse(signal))
    expect(result.phrases).toHaveLength(1)
    expect(result.notes.map((n) => n.note)).toEqual([C4, D4, E4, F4, G4])
    expect(result.notes.map((n) => n.transition)).toEqual([
      'attack',
      'legato',
      'legato',
      'legato',
      'legato',
    ])
    expect(result.slides).toEqual([])
    const sung = signal.events.filter((e) => e.kind === 'note')
    result.notes.forEach((note, i) => {
      expect(Math.abs(note.startTime - sung[i].start)).toBeLessThan(0.05)
    })
  })

  it('keeps a vibrato note whole', () => {
    const signal = noteSequence([
      seq.pause(0.2),
      seq.note(A3, 1.5, { rate: 6, extentCents: 50 }),
      seq.pause(0.2),
    ])
    const result = segmentTake(analyse(signal))
    expect(result.notes).toHaveLength(1)
    expect(result.notes[0].note).toBe(A3)
    expect(Math.abs(result.notes[0].cents)).toBeLessThan(5)
    expect(result.notes[0].spreadCents).toBeGreaterThan(20)
    expect(result.slides).toEqual([])
  })

  it('detects a portamento between two held notes', () => {
    const signal = noteSequence([
      seq.pause(0.2),
      seq.note(C4, 0.5),
      seq.slide(C4, G4, 0.4),
      seq.note(G4, 0.5),
      seq.pause(0.2),
    ])
    const result = segmentTake(analyse(signal))
    expect(result.phrases).toHaveLength(1)
    expect(result.notes.map((n) => [n.note, n.transition])).toEqual([
      [C4, 'attack'],
      [G4, 'slide'],
    ])
    expect(result.slides).toHaveLength(1)
    const slide = result.slides[0]
    expect(slide.fromNote).toBe(0)
    expect(slide.toNote).toBe(1)
    expect(slide.fromMidi).toBeCloseTo(C4, 0)
    expect(slide.toMidi).toBeCloseTo(G4, 0)
    const glide = signal.events.find((e) => e.kind === 'slide')!
    expect(Math.abs(slide.startTime - glide.start)).toBeLessThan(0.1)
    expect(Math.abs(slide.endTime - glide.end)).toBeLessThan(0.1)
  })

  it('resolves a fast legato run of 150 ms notes', () => {
    const run = [C4, D4, E4, F4, G4, F4, E4, D4, C4]
    const signal = noteSequence([
      seq.pause(0.2),
      ...run.map((midi) => seq.note(midi, 0.15)),
      seq.pause(0.2),
    ])
    const result = segmentTake(analyse(signal))
    expect(result.notes.map((n) => n.note)).toEqual(run)
    expect(result.slides).toEqual([])
    expect(result.notes.slice(1).every((n) => n.transition === 'legato')).toBe(true)
  })

  it('reports a scoop into the first note as a slide from nowhere', () => {
    const signal = noteSequence([
      seq.pause(0.2),
      seq.slide(C4 - 3, C4, 0.2),
      seq.note(C4, 0.6),
      seq.pause(0.2),
    ])
    const result = segmentTake(analyse(signal))
    expect(result.notes.map((n) => [n.note, n.transition])).toEqual([[C4, 'slide']])
    expect(result.slides).toHaveLength(1)
    expect(result.slides[0].fromNote).toBe(-1)
    expect(result.slides[0].toNote).toBe(0)
    expect(result.slides[0].fromMidi).toBeLessThan(C4 - 1.5)
  })

  it('ignores clicks shorter than a phrase', () => {
    const signal = noteSequence([seq.pause(0.3), seq.note(C4, 0.05), seq.pause(0.3)])
    const result = segmentTake(analyse(signal))
    expect(result.phrases).toEqual([])
    expect(result.notes).toEqual([])
  })
})

describe('segmentTake method mauch (Tony HMM)', () => {
  const mauch = { method: 'mauch' as const }

  it('transcribes five notes sung with pauses', () => {
    const signal = noteSequence([
      seq.pause(0.3),
      seq.note(C4, 0.5),
      seq.pause(0.4),
      seq.note(D4, 0.5),
      seq.pause(0.4),
      seq.note(E4, 0.5),
      seq.pause(0.4),
      seq.note(F4, 0.5),
      seq.pause(0.4),
      seq.note(G4, 0.5),
      seq.pause(0.3),
    ])
    const result = segmentTake(analyse(signal), 0, undefined, mauch)
    expect(result.notes.map((n) => n.note)).toEqual([C4, D4, E4, F4, G4])
    expect(result.notes.every((n) => n.transition === 'attack')).toBe(true)
    expect(result.slides).toEqual([])
    for (const note of result.notes) {
      expect(note.duration).toBeGreaterThan(0.35)
      expect(note.duration).toBeLessThan(0.6)
    }
  })

  it('splits a legato scale without inventing slides', () => {
    const signal = noteSequence([
      seq.pause(0.2),
      seq.note(C4, 0.4),
      seq.note(D4, 0.4),
      seq.note(E4, 0.4),
      seq.note(F4, 0.4),
      seq.note(G4, 0.4),
      seq.pause(0.2),
    ])
    const result = segmentTake(analyse(signal), 0, undefined, mauch)
    expect(result.notes.map((n) => n.note)).toEqual([C4, D4, E4, F4, G4])
    expect(result.notes[0].transition).toBe('attack')
    expect(result.notes.slice(1).every((n) => n.transition === 'legato')).toBe(true)
    expect(result.slides).toEqual([])
  })

  it('keeps a vibrato note as one MIDI state', () => {
    const signal = noteSequence([
      seq.pause(0.2),
      seq.note(A3, 1.5, { rate: 6, extentCents: 50 }),
      seq.pause(0.2),
    ])
    const result = segmentTake(analyse(signal), 0, undefined, mauch)
    expect(result.notes).toHaveLength(1)
    expect(result.notes[0].note).toBe(A3)
  })

  it('drops clicks shorter than minNote', () => {
    const signal = noteSequence([seq.pause(0.3), seq.note(C4, 0.05), seq.pause(0.3)])
    const result = segmentTake(analyse(signal), 0, undefined, mauch)
    expect(result.notes).toEqual([])
  })
})

describe('classifyGestures', () => {
  function painted(
    frames: number,
    columns: string[],
    fill: (timeline: Timeline) => void,
  ): Timeline {
    const timeline = new Timeline({
      sampleRate: TEST_SAMPLE_RATE,
      hopSize: 480,
      originSample: 1024,
      columns,
    })
    const empty: Record<string, Float32Array> = {}
    for (const name of columns) empty[name] = new Float32Array(frames).fill(NaN)
    timeline.appendBatch(frames, empty)
    fill(timeline)
    return timeline
  }

  const span = {
    startFrame: 10,
    endFrame: 80,
    startTime: 0.1,
    endTime: 0.8,
    duration: 0.7,
    phrase: 0,
    midi: 60,
    note: 60,
    cents: 0,
    spreadCents: 1,
    voicedFrames: 70,
    transition: 'attack' as const,
  }

  it('labels a flat contour straight', () => {
    const timeline = painted(100, ['midi'], (t) => {
      for (let i = 10; i < 80; i++) t.set('midi', i, 60)
    })
    expect(classifyGestures(timeline, [span])[0].gesture).toBe('straight')
  })

  it('labels a 6 Hz wobble as vibrato when extent is present', () => {
    const timeline = painted(100, ['midi', 'vibratoRate', 'vibratoExtent'], (t) => {
      for (let i = 10; i < 80; i++) {
        t.set('midi', i, 60)
        t.set('vibratoRate', i, 6)
        t.set('vibratoExtent', i, 40)
      }
    })
    const [gesture] = classifyGestures(timeline, [span])
    expect(gesture.gesture).toBe('vibrato')
    expect(gesture.vibratoRate).toBeCloseTo(6, 5)
    expect(gesture.vibratoExtent).toBeCloseTo(40, 5)
  })

  it('labels a rise into the note as a scoop', () => {
    const timeline = painted(100, ['midi'], (t) => {
      for (let i = 10; i < 80; i++) t.set('midi', i, i < 30 ? 58.2 : 60)
    })
    expect(classifyGestures(timeline, [span])[0].gesture).toBe('scoop')
  })

  it('labels a drop at the end as a fall', () => {
    const timeline = painted(100, ['midi'], (t) => {
      for (let i = 10; i < 80; i++) t.set('midi', i, i >= 60 ? 58.2 : 60)
    })
    expect(classifyGestures(timeline, [span])[0].gesture).toBe('fall')
  })
})
