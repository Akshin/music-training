import { describe, expect, it } from 'vitest'

import { amplitudeToDb, dbToAmplitude, peak, rms } from './level'
import { sine } from '../testing/signals'

describe('level', () => {
  it('rms of a sine is A/√2', () => {
    const { samples } = sine({ frequency: 100, seconds: 1, amplitude: 0.8 })
    expect(rms(samples)).toBeCloseTo(0.8 / Math.SQRT2, 4)
  })

  it('rms over a sub-range and of nothing', () => {
    expect(rms(new Float32Array([0, 0, 1, 1]), 2, 4)).toBe(1)
    expect(rms(new Float32Array(0))).toBe(0)
  })

  it('peak is the largest absolute sample', () => {
    expect(peak(new Float32Array([0.1, -0.7, 0.3]))).toBeCloseTo(0.7, 6)
  })

  it('converts amplitude to dBFS with a floor for silence', () => {
    expect(amplitudeToDb(1)).toBeCloseTo(0, 12)
    expect(amplitudeToDb(0.5)).toBeCloseTo(-6.0206, 3)
    expect(amplitudeToDb(0)).toBe(-120)
    expect(amplitudeToDb(1e-9, -60)).toBe(-60)
    expect(amplitudeToDb(NaN)).toBeNaN()
  })

  it('round-trips through decibels', () => {
    expect(dbToAmplitude(amplitudeToDb(0.25))).toBeCloseTo(0.25, 12)
  })
})
