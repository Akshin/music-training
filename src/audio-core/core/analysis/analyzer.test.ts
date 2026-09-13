import { describe, expect, it } from 'vitest'

import { createAnalyzer } from './analyzer'
import { defineExtractor } from './extractor'
import { f0 } from './extractors/f0'
import { level } from './extractors/level'
import { pitch } from './extractors/pitch'
import { spectrum } from './extractors/spectrum'
import { fitTimeShift, type ContourSample } from '../testing/contour'
import {
  concat,
  harmonicTone,
  silence,
  sine,
  sweep,
  toChunks,
  TEST_SAMPLE_RATE as SR,
} from '../testing/signals'

const FRAME = 2048
const HOP = 480

function expectedFrames(samples: number): number {
  return samples < FRAME ? 0 : Math.floor((samples - FRAME) / HOP) + 1
}

function centsError(measured: number, expected: number): number {
  return Math.abs(1200 * Math.log2(measured / expected))
}

describe('Analyzer', () => {
  it('derives a 100 frames/s hop and centres frame time on the window', () => {
    const analyzer = createAnalyzer({ sampleRate: 44100 }, [level])
    expect(analyzer.context.hopSize).toBe(441)
    expect(analyzer.timeline.frameRate).toBe(100)
    expect(analyzer.timeline.originSample).toBe(FRAME / 2)
  })

  it('produces the same timeline regardless of chunking', () => {
    const { samples } = sine({ frequency: 440, seconds: 1 })
    const reference = createAnalyzer({ sampleRate: SR }, [f0])
    reference.push(samples)
    expect(reference.timeline.length).toBe(expectedFrames(samples.length))

    for (const chunkSize of [128, 1000, 4096]) {
      const analyzer = createAnalyzer({ sampleRate: SR }, [f0])
      let produced = 0
      for (const chunk of toChunks(samples, chunkSize)) produced += analyzer.push(chunk)
      expect(produced).toBe(reference.timeline.length)
      expect(Array.from(analyzer.timeline.slice('f0'))).toEqual(
        Array.from(reference.timeline.slice('f0')),
      )
    }
  })

  it('zero-fills gaps and drops overlaps so the clock never drifts', () => {
    const analyzer = createAnalyzer({ sampleRate: SR }, [level])
    const block = sine({ frequency: 440, seconds: 0.1 }).samples
    analyzer.push({ samples: block, startSample: 0, sampleRate: SR })
    analyzer.push({ samples: block, startSample: block.length + 960, sampleRate: SR })
    analyzer.push({ samples: block, startSample: 2 * block.length + 960 - 100, sampleRate: SR })
    const stats = analyzer.getStats()
    expect(stats.gapSamples).toBe(960)
    expect(stats.overlapSamples).toBe(100)
    // Three blocks plus the synthesised gap, minus the duplicated 100 samples.
    expect(stats.samples).toBe(3 * block.length + 960 - 100)
    expect(analyzer.timeline.length).toBe(expectedFrames(stats.samples))
  })

  it('rejects chunks with a different sample rate', () => {
    const analyzer = createAnalyzer({ sampleRate: SR }, [level])
    expect(() =>
      analyzer.push({ samples: new Float32Array(10), startSample: 0, sampleRate: 44100 }),
    ).toThrow(/sample rate/)
  })

  it('auto-includes dependencies and orders them', () => {
    const analyzer = createAnalyzer({ sampleRate: SR }, [pitch])
    expect(analyzer.extractors.map((e) => e.id)).toEqual(['f0', 'pitch'])
    expect(analyzer.timeline.columns).toEqual(['f0', 'f0Confidence', 'midi', 'note', 'cents'])
  })

  it('passes options by extractor id', () => {
    const { samples } = sine({ frequency: 440, seconds: 0.3 })
    const analyzer = createAnalyzer({ sampleRate: SR }, [pitch], { pitch: { a4: 442 } })
    analyzer.push(samples)
    expect(analyzer.timeline.latest('note')).toBe(69)
    // 1200·log2(440/442) = −7.85 cents; allow the detector's sub-cent error.
    expect(Math.abs(analyzer.timeline.latest('cents') + 7.85)).toBeLessThan(0.5)
  })

  it('notifies listeners with per-frame results and supports unsubscribe', () => {
    const analyzer = createAnalyzer({ sampleRate: SR }, [spectrum, level])
    const seen: number[] = []
    const stop = analyzer.onFrame((frame, results) => {
      seen.push(frame.index)
      expect(results.get(spectrum).bins).toBe(FRAME / 2 + 1)
      expect(results.get(level).rms).toBeGreaterThan(0)
    })
    analyzer.push(sine({ frequency: 1000, seconds: 0.2 }).samples)
    expect(seen).toEqual([...Array(analyzer.timeline.length).keys()])
    stop()
    analyzer.push(sine({ frequency: 1000, seconds: 0.2 }).samples)
    expect(seen.length).toBeLessThan(analyzer.timeline.length)
  })

  it('rejects writes to undeclared columns', () => {
    const rogue = defineExtractor<void>({
      id: 'rogue',
      deps: [],
      columns: ['declared'],
      create: () => ({
        process: (_frame, _deps, out) => {
          out.set('undeclared', 1)
        },
      }),
    })
    const analyzer = createAnalyzer({ sampleRate: SR }, [rogue])
    expect(() => analyzer.push(new Float32Array(FRAME))).toThrow(/did not declare column/)
  })

  it('reset clears buffered samples and extractor state but keeps the timeline', () => {
    const analyzer = createAnalyzer({ sampleRate: SR }, [level])
    analyzer.push(new Float32Array(FRAME + 100))
    expect(analyzer.timeline.length).toBe(1)
    analyzer.reset()
    analyzer.push(new Float32Array(FRAME - 1))
    expect(analyzer.timeline.length).toBe(1)
  })
})

describe('extractors', () => {
  it('level: rms, dBFS and peak of a sine', () => {
    const analyzer = createAnalyzer({ sampleRate: SR }, [level])
    analyzer.push(sine({ frequency: 440, seconds: 0.2, amplitude: 0.5 }).samples)
    expect(analyzer.timeline.latest('rms')).toBeCloseTo(0.5 / Math.SQRT2, 3)
    expect(analyzer.timeline.latest('dbfs')).toBeCloseTo(-9.03, 1)
    expect(analyzer.timeline.latest('peak')).toBeCloseTo(0.5, 3)
    const quiet = createAnalyzer({ sampleRate: SR }, [level], { level: { floorDb: -90 } })
    quiet.push(silence(0.2))
    expect(quiet.timeline.latest('dbfs')).toBe(-90)
  })

  it('spectrum: a full-scale sine reads ≈ 1.0 at its bin', () => {
    const analyzer = createAnalyzer({ sampleRate: SR }, [spectrum])
    const bin = 40
    const frequency = (bin * SR) / FRAME
    let captured: Float32Array | undefined
    analyzer.onFrame((_frame, results) => {
      captured = Float32Array.from(results.get(spectrum).magnitude)
    })
    analyzer.push(sine({ frequency, seconds: 0.1, amplitude: 1 }).samples)
    expect(captured).toBeDefined()
    expect(captured![bin]).toBeCloseTo(1, 2)
    expect(captured![bin + 10]).toBeLessThan(1e-3)
    expect(analyzer.results.get(spectrum).binHz).toBeCloseTo(SR / FRAME, 9)
  })

  it('f0 + pitch: 440 Hz sine → A4, all frames voiced within 0.5 cents', () => {
    const analyzer = createAnalyzer({ sampleRate: SR }, [pitch])
    analyzer.push(sine({ frequency: 440, seconds: 0.5 }).samples)
    const { timeline } = analyzer
    for (let i = 0; i < timeline.length; i++) {
      expect(centsError(timeline.get('f0', i), 440)).toBeLessThan(0.5)
      expect(timeline.get('f0Confidence', i)).toBeGreaterThan(0.99)
      expect(timeline.get('note', i)).toBe(69)
      expect(Math.abs(timeline.get('cents', i))).toBeLessThan(0.5)
      expect(timeline.get('midi', i)).toBeCloseTo(69, 2)
    }
  })

  it('f0: silence between tones is unvoiced (NaN) and tones are voiced', () => {
    const analyzer = createAnalyzer({ sampleRate: SR }, [f0])
    const tone = sine({ frequency: 330, seconds: 0.3 }).samples
    analyzer.push(concat(tone, silence(0.3), tone))
    const { timeline } = analyzer
    const middle = timeline.frameAt(0.45)
    expect(timeline.get('f0', middle)).toBeNaN()
    expect(timeline.get('f0Confidence', middle)).toBe(0)
    expect(timeline.get('f0', timeline.frameAt(0.15))).toBeCloseTo(330, 0)
    expect(timeline.get('f0', timeline.frameAt(0.75))).toBeCloseTo(330, 0)
  })

  it('f0: timeline frame time is the measurement centre (vibrato contour has no time shift)', () => {
    const tone = harmonicTone({ f0: 220, seconds: 1, vibrato: { rate: 6, extentCents: 100 } })
    const analyzer = createAnalyzer({ sampleRate: SR }, [f0])
    analyzer.push(tone.samples)
    const { timeline } = analyzer
    const measured: ContourSample[] = []
    for (let i = 0; i < timeline.length; i++) {
      measured.push({ time: timeline.frameTime(i), frequency: timeline.get('f0', i) })
    }
    const fit = fitTimeShift(measured, tone.frequencyAt)
    expect(Math.abs(fit.shiftSeconds)).toBeLessThan(0.001)
    expect(fit.rmsCentsUnshifted).toBeLessThan(6)
  })

  it('f0: follows a 3-octave sweep within 3 cents', () => {
    const glide = sweep({ startHz: 110, endHz: 880, seconds: 6 })
    const analyzer = createAnalyzer({ sampleRate: SR }, [f0])
    analyzer.push(glide.samples)
    const { timeline } = analyzer
    let worst = 0
    for (let i = 0; i < timeline.length; i++) {
      worst = Math.max(
        worst,
        centsError(timeline.get('f0', i), glide.frequencyAt(timeline.frameTime(i))),
      )
    }
    expect(worst).toBeLessThan(3)
  })
})
