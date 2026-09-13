import { describe, expect, it } from 'vitest'

import { BeatGrid } from '../clock/beat-grid'
import { Timeline } from '../model/timeline'
import type { NoteSegment } from '../segmentation/types'
import { estimateLatency } from './latency'
import { onsetTimes } from './onsets'
import { scoreTake, velocityToDb } from './score'

function span(start: number, end: number, midi: number): NoteSegment {
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
    transition: 'attack',
  }
}

describe('estimateLatency', () => {
  it('returns the median residual of matched clicks', () => {
    const expected = [0, 0.5, 1, 1.5]
    const detected = expected.map((t) => t + 0.041)
    detected[2] += 0.004
    const estimate = estimateLatency(expected, detected)
    expect(estimate?.hits).toBe(4)
    expect(estimate?.seconds).toBeCloseTo(0.041, 3)
  })

  it('ignores onsets outside the window and unmatched clicks', () => {
    expect(estimateLatency([0, 1], [0.02, 3])).toMatchObject({ hits: 1, expected: 2 })
    expect(estimateLatency([0], [])).toBeUndefined()
  })
})

describe('onsetTimes', () => {
  it('fires once per burst above the gate', () => {
    const timeline = new Timeline({
      sampleRate: 48000,
      hopSize: 480,
      originSample: 1024,
      columns: ['dbfs'],
    })
    const frames = 200
    const dbfs = new Float32Array(frames).fill(-80)
    dbfs.fill(-12, 40, 55)
    dbfs.fill(-12, 90, 110)
    dbfs.fill(-12, 94, 96) // inside the refractory of the second burst
    timeline.appendBatch(frames, { dbfs })
    const times = onsetTimes(timeline, { gateDb: -40 })
    expect(times).toHaveLength(2)
    expect(times[0]).toBeCloseTo(timeline.frameTime(40), 9)
    expect(times[1]).toBeCloseTo(timeline.frameTime(90), 9)
  })
})

describe('scoreTake', () => {
  const grid = new BeatGrid({ bpm: 60 })
  const targets = [
    { midi: 60, startBeat: 0, durationBeats: 1 },
    { midi: 64, startBeat: 1, durationBeats: 1 },
  ]

  it('scores a perfect take as 1', () => {
    const sung = [span(0, 0.9, 60), span(1, 1.9, 64)]
    const score = scoreTake(targets, sung, grid)
    expect(score.matched).toBe(2)
    expect(score.pitch).toBe(1)
    expect(score.rhythm).toBe(1)
    expect(score.overall).toBe(1)
    expect(score.notes[0].pitch?.inTune).toBe(true)
    expect(score.notes[0].rhythm?.inTime).toBe(true)
  })

  it('drops pitch when the sung note is 50 cents sharp', () => {
    const sung = [span(0, 0.9, 60.5), span(1, 1.9, 64)]
    const score = scoreTake(targets, sung, grid, undefined, { pitchToleranceCents: 50 })
    expect(score.notes[0].pitch?.cents).toBeCloseTo(50, 5)
    expect(score.notes[0].pitch?.inTune).toBe(true)
    expect(score.notes[0].pitch?.value).toBeCloseTo(0.5, 5)
    expect(score.notes[1].pitch?.value).toBe(1)
  })

  it('applies latency so a late timeline still scores in time', () => {
    const latency = 0.12
    const sung = [span(latency, latency + 0.9, 60), span(1 + latency, 1 + latency + 0.9, 64)]
    const raw = scoreTake(targets, sung, grid)
    expect(raw.notes[0].rhythm?.inTime).toBe(false)
    const aligned = scoreTake(targets, sung, grid, undefined, { latencySeconds: latency })
    expect(aligned.rhythm).toBe(1)
    expect(aligned.notes[0].rhythm?.offsetSeconds).toBeCloseTo(0, 12)
  })

  it('unmatched targets score 0 and do not steal a later sung note', () => {
    const sung = [span(1, 1.8, 64)]
    const score = scoreTake(targets, sung, grid)
    expect(score.matched).toBe(1)
    expect(score.notes[0].sung).toBeUndefined()
    expect(score.notes[1].sung?.note).toBe(64)
    expect(score.pitch).toBe(0.5)
  })
})

describe('velocityToDb', () => {
  it('maps full scale to 0 dBFS and a quarter to −12', () => {
    expect(velocityToDb(1)).toBeCloseTo(0, 12)
    expect(velocityToDb(0.25)).toBeCloseTo(20 * Math.log10(0.25), 12)
  })
})
