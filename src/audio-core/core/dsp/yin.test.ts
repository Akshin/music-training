import { describe, expect, it } from 'vitest'

import { Yin } from './yin'
import { fitTimeShift, peakExcursionCents, type ContourSample } from '../testing/contour'
import { harmonicTone, silence, sine, whiteNoise } from '../testing/signals'

const FRAME = 2048

function centsError(measured: number, expected: number): number {
  return Math.abs(1200 * Math.log2(measured / expected))
}

/** Runs the detector over consecutive frames and returns the worst cents error and lowest confidence. */
function track(
  yin: Yin,
  samples: Float32Array,
  expected: (centreSeconds: number) => number,
  hop = 480,
): { maxCents: number; minConfidence: number; frames: number } {
  let maxCents = 0
  let minConfidence = 1
  let frames = 0
  for (let start = 0; start + FRAME <= samples.length; start += hop) {
    const result = yin.detect(samples.subarray(start, start + FRAME))
    const centre = (start + FRAME / 2) / yin.sampleRate
    maxCents = Math.max(maxCents, centsError(result.frequency, expected(centre)))
    minConfidence = Math.min(minConfidence, result.confidence)
    frames++
  }
  return { maxCents, minConfidence, frames }
}

describe('Yin', () => {
  it('validates the resolvable range', () => {
    expect(() => new Yin({ frameSize: FRAME, sampleRate: 48000, minFrequency: 10 })).not.toThrow()
    expect(
      () => new Yin({ frameSize: 256, sampleRate: 48000, minFrequency: 50, maxFrequency: 60 }),
    ).toThrow(RangeError)
  })

  it('exposes the frequency range implied by frameSize', () => {
    const yin = new Yin({ frameSize: FRAME, sampleRate: 48000, minFrequency: 20 })
    // Lags are limited to frameSize/2 − 1 = 1023 samples → 46.9 Hz at 48 kHz.
    expect(yin.minFrequency).toBeCloseTo(48000 / 1023, 6)
    expect(yin.maxFrequency).toBeCloseTo(48000 / 32, 6)
  })

  describe.each([48000, 44100])('at %i Hz', (sampleRate) => {
    const yin = new Yin({ frameSize: FRAME, sampleRate })

    it.each([55, 82.41, 110, 220, 440, 880, 1046.5])(
      'pure sine at %f Hz within 0.5 cents, confidence > 0.99',
      (frequency) => {
        const { samples } = sine({ frequency, seconds: 0.5, sampleRate })
        const { maxCents, minConfidence, frames } = track(yin, samples, () => frequency)
        expect(frames).toBeGreaterThan(5)
        expect(maxCents).toBeLessThan(0.5)
        expect(minConfidence).toBeGreaterThan(0.99)
      },
    )

    it('harmonic complex (10 partials, 1/k) at 200 Hz within 0.5 cents', () => {
      const { samples } = harmonicTone({ f0: 200, seconds: 0.5, sampleRate, harmonics: 10 })
      const { maxCents, minConfidence } = track(yin, samples, () => 200)
      expect(maxCents).toBeLessThan(0.5)
      expect(minConfidence).toBeGreaterThan(0.99)
    })
  })

  it('does not jump an octave when the 2nd partial is louder than the fundamental', () => {
    const yin = new Yin({ frameSize: FRAME, sampleRate: 48000 })
    const { samples } = harmonicTone({
      f0: 196,
      seconds: 0.5,
      partials: [0.4, 1, 0.6, 0.3],
    })
    const { maxCents } = track(yin, samples, () => 196)
    expect(maxCents).toBeLessThan(0.5)
  })

  it('measures a 6 Hz ±100 cent vibrato at the window centre, without time shift', () => {
    const yin = new Yin({ frameSize: FRAME, sampleRate: 48000 })
    const tone = harmonicTone({
      f0: 220,
      seconds: 1,
      harmonics: 6,
      vibrato: { rate: 6, extentCents: 100 },
    })
    const measured: ContourSample[] = []
    for (let start = 0; start + FRAME <= tone.samples.length; start += 480) {
      const time = (start + FRAME / 2) / 48000
      measured.push({
        time,
        frequency: yin.detect(tone.samples.subarray(start, start + FRAME)).frequency,
      })
    }
    // Textbook YIN integrates over the head of the frame and would fit best ~8 ms late.
    const fit = fitTimeShift(measured, tone.frequencyAt)
    expect(Math.abs(fit.shiftSeconds)).toBeLessThan(0.001)
    // The 43 ms window low-passes the contour: sinc(6 Hz · 42.7 ms) ≈ 0.895, so ±100 cents reads
    // as ≈ ±90. Deterministic, to be compensated by the vibrato extractor from the measured rate.
    const excursion = peakExcursionCents(measured, 220)
    expect(excursion).toBeGreaterThan(85)
    expect(excursion).toBeLessThan(100)
    expect(fit.rmsCentsUnshifted).toBeLessThan(6)
  })

  it('reports silence as unvoiced', () => {
    const yin = new Yin({ frameSize: FRAME, sampleRate: 48000 })
    const result = yin.detect(silence(FRAME / 48000))
    expect(result.frequency).toBeNaN()
    expect(result.confidence).toBe(0)
  })

  it('gives white noise low confidence', () => {
    const yin = new Yin({ frameSize: FRAME, sampleRate: 48000 })
    const noise = whiteNoise({ seconds: 1, seed: 42 })
    let maxConfidence = 0
    for (let start = 0; start + FRAME <= noise.length; start += 480) {
      const result = yin.detect(noise.subarray(start, start + FRAME))
      maxConfidence = Math.max(maxConfidence, result.confidence)
      expect(result.belowThreshold).toBe(false)
    }
    expect(maxConfidence).toBeLessThan(0.5)
  })

  it('reuses its result object and does not allocate per call', () => {
    const yin = new Yin({ frameSize: FRAME, sampleRate: 48000 })
    const { samples } = sine({ frequency: 300, seconds: 0.1 })
    const first = yin.detect(samples)
    const second = yin.detect(samples)
    expect(second).toBe(first)
  })
})
