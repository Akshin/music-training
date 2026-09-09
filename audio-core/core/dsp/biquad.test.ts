import { describe, expect, it } from 'vitest'

import { Biquad, biquadMagnitude, lowpassBiquad, resonatorBiquad } from './biquad'

describe('Biquad', () => {
  it('passes DC through a unity filter', () => {
    const thru = new Biquad({ b0: 1, b1: 0, b2: 0, a1: 0, a2: 0 })
    expect(thru.processSample(0.5)).toBe(0.5)
    expect(thru.processSample(-0.25)).toBe(-0.25)
  })

  it('matches the closed-form magnitude of a resonator at its centre', () => {
    const freq = 1000
    const sr = 48000
    const filter = resonatorBiquad(freq, 80, sr)
    const omega = (2 * Math.PI * freq) / sr
    expect(biquadMagnitude(filter, omega)).toBeCloseTo(1, 10)
  })

  it('low-pass attenuates Nyquist', () => {
    const sr = 48000
    const lp = lowpassBiquad(1000, sr)
    const nyquist = Math.PI
    const dc = 0
    expect(biquadMagnitude(lp, dc)).toBeGreaterThan(0.9)
    expect(biquadMagnitude(lp, nyquist)).toBeLessThan(0.05)
  })
})
