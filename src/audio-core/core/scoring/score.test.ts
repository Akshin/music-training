import { describe, expect, it } from 'vitest'

import { BeatGrid } from '../clock/beat-grid'
import { Timeline } from '../model/timeline'
import type { NoteSegment } from '../segmentation/types'
import { estimateLatency } from './latency'
import { onsetTimes, pcmOnsets } from './onsets'
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

describe('pcmOnsets', () => {
  const rate = 48000

  /** Quiet noise with sounds dropped in: `[seconds, length, amplitude, hz?]`. */
  function signal(seconds: number, sounds: [number, number, number, number?][]): Float32Array {
    const samples = new Float32Array(Math.round(seconds * rate))
    let seed = 7
    for (let i = 0; i < samples.length; i++) {
      seed = (seed * 1103515245 + 12345) % 2147483648
      samples[i] = (seed / 2147483648 - 0.5) * 0.001
    }
    for (const [at, length, amplitude, hz] of sounds) {
      const from = Math.round(at * rate)
      for (let i = 0; i < Math.round(length * rate); i++) {
        const decay = hz === undefined ? Math.exp(-i / (0.002 * rate)) : 1
        const wave =
          hz === undefined ? (i % 2 === 0 ? 1 : -1) : Math.sin((2 * Math.PI * hz * i) / rate)
        samples[from + i] += amplitude * decay * wave
      }
    }
    return samples
  }

  it('finds clicks to the sample and ignores their echo', () => {
    const clicks = [0.2, 0.95, 1.7, 2.45]
    const samples = signal(3, [
      ...clicks.map((at): [number, number, number] => [at, 0.01, 0.5]),
      // An echo of the second click 40 ms later.
      [0.99, 0.01, 0.2],
    ])
    const found = pcmOnsets(samples, rate)
    expect(found).toHaveLength(clicks.length)
    found.forEach((at, i) => expect(Math.abs(at - clicks[i])).toBeLessThan(0.0005))
  })

  it('finds a sung syllable where it starts, once', () => {
    const found = pcmOnsets(
      signal(1.5, [
        [0.3, 0.4, 0.3, 220],
        [0.9, 0.4, 0.3, 247],
      ]),
      rate,
    )
    expect(found).toHaveLength(2)
    expect(Math.abs(found[0] - 0.3)).toBeLessThan(0.002)
    expect(Math.abs(found[1] - 0.9)).toBeLessThan(0.002)
  })

  it('finds nothing in silence', () => {
    expect(pcmOnsets(signal(1, []), rate)).toEqual([])
    expect(pcmOnsets(new Float32Array(10), rate)).toEqual([])
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
