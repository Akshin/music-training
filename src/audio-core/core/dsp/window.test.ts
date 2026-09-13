import { describe, expect, it } from 'vitest'

import {
  applyWindow,
  blackmanHarris,
  gaussian,
  hamming,
  hann,
  makeWindow,
  windowSum,
} from './window'

describe('windows', () => {
  it('periodic Hann starts at 0, peaks at 1 in the middle and sums to N/2', () => {
    const w = hann(256)
    expect(w[0]).toBeCloseTo(0, 12)
    expect(w[128]).toBeCloseTo(1, 12)
    expect(windowSum(w)).toBeCloseTo(128, 9)
  })

  it('symmetric Hann is mirror-symmetric with zero endpoints', () => {
    const w = hann(9, false)
    expect(w[0]).toBeCloseTo(0, 12)
    expect(w[8]).toBeCloseTo(0, 12)
    expect(w[4]).toBeCloseTo(1, 12)
    for (let i = 0; i < 9; i++) expect(w[i]).toBeCloseTo(w[8 - i], 12)
  })

  it('Hamming has the classic 0.08 pedestal', () => {
    expect(hamming(64)[0]).toBeCloseTo(0.08, 12)
  })

  it('Blackman-Harris is close to zero at the edges and 1 at the centre', () => {
    const w = blackmanHarris(128)
    expect(w[0]).toBeLessThan(1e-4)
    expect(w[64]).toBeCloseTo(1, 6)
  })

  it('Gaussian is symmetric and peaks at 1', () => {
    const w = gaussian(101, 0.4)
    expect(w[50]).toBeCloseTo(1, 12)
    for (let i = 0; i < 101; i++) expect(w[i]).toBeCloseTo(w[100 - i], 12)
    expect(w[0]).toBeCloseTo(Math.exp(-0.5 / 0.16), 12)
  })

  it('applies a window element-wise', () => {
    const input = new Float32Array([1, 2, 3, 4])
    const out = new Float64Array(4)
    applyWindow(input, makeWindow('rectangular', 4), out)
    expect([...out]).toEqual([1, 2, 3, 4])
    applyWindow(input, new Float64Array([0.5, 0.5, 0.5, 0.5]), out)
    expect([...out]).toEqual([0.5, 1, 1.5, 2])
  })
})
