import { describe, expect, it } from 'vitest'

import { parabolicOffset, parabolicValue, sinc } from './interpolate'

describe('parabolic interpolation', () => {
  it('recovers the vertex of a sampled parabola', () => {
    const vertex = 0.3
    const f = (x: number): number => 2 * (x - vertex) ** 2 - 1
    const offset = parabolicOffset(f(-1), f(0), f(1))
    expect(offset).toBeCloseTo(vertex, 12)
    expect(parabolicValue(f(-1), f(0), f(1), offset)).toBeCloseTo(-1, 12)
  })

  it('works for maxima as well as minima', () => {
    const f = (x: number): number => -((x + 0.25) ** 2)
    expect(parabolicOffset(f(-1), f(0), f(1))).toBeCloseTo(-0.25, 12)
  })

  it('clamps to half a sample and handles flat input', () => {
    expect(parabolicOffset(1, 1, 1)).toBe(0)
    expect(parabolicOffset(0, 1, 2.5)).toBe(-0.5)
    expect(parabolicOffset(2.5, 1, 0)).toBe(0.5)
  })
})

describe('sinc', () => {
  it('is 1 at 0 and matches sin(πx)/(πx)', () => {
    expect(sinc(0)).toBe(1)
    expect(sinc(1)).toBeCloseTo(0, 12)
    expect(sinc(0.256)).toBeCloseTo(Math.sin(Math.PI * 0.256) / (Math.PI * 0.256), 12)
  })
})
