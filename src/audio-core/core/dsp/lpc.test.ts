import { describe, expect, it } from 'vitest'

import { burg, createBurgScratch, lpcFormants } from './lpc'
import { durandKerner } from './roots'
import { whiteNoise } from '../testing/signals'

describe('durandKerner', () => {
  it('finds the roots of (z − 2)(z − 3) = z² − 5z + 6', () => {
    const coeffs = Float64Array.from([1, -5, 6])
    const re = new Float64Array(2)
    const im = new Float64Array(2)
    durandKerner(coeffs, re, im)
    const roots = [re[0], re[1]].sort((a, b) => a - b)
    expect(roots[0]).toBeCloseTo(2, 6)
    expect(roots[1]).toBeCloseTo(3, 6)
    expect(Math.abs(im[0])).toBeLessThan(1e-6)
    expect(Math.abs(im[1])).toBeLessThan(1e-6)
  })
})

describe('burg', () => {
  it('recovers an AR(2) resonator', () => {
    const sr = 48000
    const r = 0.95
    const theta = (2 * Math.PI * 1000) / sr
    const a1 = -2 * r * Math.cos(theta)
    const a2 = r * r
    const n = 2048
    const noise = whiteNoise({ seconds: n / sr, seed: 7, amplitude: 0.02 })
    const x = new Float64Array(n)
    x[0] = noise[0]
    x[1] = noise[1]
    for (let i = 2; i < n; i++) x[i] = noise[i] - a1 * x[i - 1] - a2 * x[i - 2]
    const order = 2
    const scratch = createBurgScratch(n, order)
    const error = burg(x, n, order, scratch)
    expect(error).toBeGreaterThan(0)
    expect(scratch.a[1]).toBeCloseTo(a1, 1)
    expect(scratch.a[2]).toBeCloseTo(a2, 1)
    const [formant] = lpcFormants(scratch, order, sr, {
      minHz: 200,
      maxHz: 4000,
      minBw: 10,
      maxBw: 2000,
      count: 1,
    })
    expect(formant).toBeDefined()
    expect(Math.abs(formant.frequency - 1000)).toBeLessThan(40)
  })
})
