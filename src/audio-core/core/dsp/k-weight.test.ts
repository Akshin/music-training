import { describe, expect, it } from 'vitest'

import { ITU_48K_HIGHPASS, ITU_48K_SHELF, kWeightingCoeffs, kWeightingGain } from './k-weight'
import { LUFS_OFFSET, meanSquareToLufs } from './lufs'

describe('K-weighting', () => {
  it('reproduces the ITU-R BS.1770-4 48 kHz shelf', () => {
    const [shelf] = kWeightingCoeffs(48000)
    expect(shelf.b0).toBeCloseTo(ITU_48K_SHELF.b0, 8)
    expect(shelf.b1).toBeCloseTo(ITU_48K_SHELF.b1, 8)
    expect(shelf.b2).toBeCloseTo(ITU_48K_SHELF.b2, 8)
    expect(shelf.a1).toBeCloseTo(ITU_48K_SHELF.a1, 8)
    expect(shelf.a2).toBeCloseTo(ITU_48K_SHELF.a2, 8)
  })

  it('reproduces the 48 kHz high-pass poles (numerator is bilinear-normalised)', () => {
    const [, highpass] = kWeightingCoeffs(48000)
    expect(highpass.a1).toBeCloseTo(ITU_48K_HIGHPASS.a1, 6)
    expect(highpass.a2).toBeCloseTo(ITU_48K_HIGHPASS.a2, 6)
    expect(highpass.b1 / highpass.b0).toBeCloseTo(-2, 10)
    expect(highpass.b2 / highpass.b0).toBeCloseTo(1, 10)
  })

  it('has near-unity gain at 1 kHz and rolls off below 40 Hz', () => {
    const sr = 48000
    const at1k = kWeightingGain(sr, 1000)
    const at20 = kWeightingGain(sr, 20)
    expect(20 * Math.log10(at1k)).toBeGreaterThan(-1)
    expect(20 * Math.log10(at1k)).toBeLessThan(2)
    expect(at20).toBeLessThan(at1k * 0.5)
  })
})

describe('meanSquareToLufs', () => {
  it('applies the BS.1770 mono offset', () => {
    expect(meanSquareToLufs(1)).toBeCloseTo(LUFS_OFFSET, 12)
    expect(meanSquareToLufs(0.5)).toBeCloseTo(LUFS_OFFSET + 10 * Math.log10(0.5), 12)
    expect(meanSquareToLufs(0)).toBe(-Infinity)
  })
})
