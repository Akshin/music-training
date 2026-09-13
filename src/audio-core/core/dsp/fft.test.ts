import { describe, expect, it } from 'vitest'

import { Fft, RealFft } from './fft'
import { whiteNoise } from '../testing/signals'

function naiveDft(re: Float64Array, im: Float64Array): { re: Float64Array; im: Float64Array } {
  const n = re.length
  const outRe = new Float64Array(n)
  const outIm = new Float64Array(n)
  for (let k = 0; k < n; k++) {
    let sumRe = 0
    let sumIm = 0
    for (let t = 0; t < n; t++) {
      const angle = (-2 * Math.PI * k * t) / n
      const c = Math.cos(angle)
      const s = Math.sin(angle)
      sumRe += re[t] * c - im[t] * s
      sumIm += re[t] * s + im[t] * c
    }
    outRe[k] = sumRe
    outIm[k] = sumIm
  }
  return { re: outRe, im: outIm }
}

function maxAbsDiff(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let max = 0
  for (let i = 0; i < a.length; i++) max = Math.max(max, Math.abs(a[i] - b[i]))
  return max
}

describe('Fft', () => {
  it('rejects sizes that are not powers of two', () => {
    expect(() => new Fft(1000)).toThrow(RangeError)
    expect(() => new Fft(1)).toThrow(RangeError)
  })

  it.each([8, 64, 256])('matches a naive DFT for complex input of size %i', (size) => {
    const noise = whiteNoise({ seconds: size / 48000, seed: size })
    const re = Float64Array.from(noise)
    const im = Float64Array.from(whiteNoise({ seconds: size / 48000, seed: size + 1 }))
    const expected = naiveDft(re, im)
    new Fft(size).forward(re, im)
    expect(maxAbsDiff(re, expected.re)).toBeLessThan(1e-9)
    expect(maxAbsDiff(im, expected.im)).toBeLessThan(1e-9)
  })

  it('inverse undoes forward', () => {
    const size = 1024
    const original = Float64Array.from(whiteNoise({ seconds: size / 48000, seed: 7 }))
    const re = Float64Array.from(original)
    const im = new Float64Array(size)
    const fft = new Fft(size)
    fft.forward(re, im)
    fft.inverse(re, im)
    expect(maxAbsDiff(re, original)).toBeLessThan(1e-12)
    expect(maxAbsDiff(im, new Float64Array(size))).toBeLessThan(1e-12)
  })

  it('puts an impulse into a flat spectrum', () => {
    const re = new Float64Array(16)
    const im = new Float64Array(16)
    re[0] = 1
    new Fft(16).forward(re, im)
    for (let k = 0; k < 16; k++) {
      expect(re[k]).toBeCloseTo(1, 12)
      expect(im[k]).toBeCloseTo(0, 12)
    }
  })
})

describe('RealFft', () => {
  it('reports a bin-centred sine with magnitude A·N/2 at its bin', () => {
    const size = 512
    const bin = 37
    const amplitude = 0.8
    const input = new Float32Array(size)
    for (let i = 0; i < size; i++) input[i] = amplitude * Math.sin((2 * Math.PI * bin * i) / size)
    const fft = new RealFft(size)
    fft.forward(input)
    const magnitude = new Float64Array(fft.bins)
    fft.magnitude(magnitude)
    expect(magnitude[bin]).toBeCloseTo((amplitude * size) / 2, 6)
    // Other bins only hold Float32 rounding noise of the input (≈ −120 dB below the peak).
    for (let k = 0; k < fft.bins; k++) {
      if (k !== bin) expect(magnitude[k]).toBeLessThan(1e-4)
    }
  })

  it('zero-pads short input and maps bins to frequencies', () => {
    const fft = new RealFft(64)
    fft.forward(new Float32Array([1]))
    expect(fft.re[0]).toBe(1)
    expect(fft.bins).toBe(33)
    expect(fft.binFrequency(32, 48000)).toBe(24000)
  })
})
