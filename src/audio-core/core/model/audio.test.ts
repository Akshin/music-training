import { describe, expect, it } from 'vitest'

import { chunkSamples, frameCount } from './audio'

const SR = 48000

describe('chunkSamples', () => {
  it('splits a buffer into contiguous chunks with a running startSample', () => {
    const samples = new Float32Array(10).map((_, i) => i)
    const chunks = chunkSamples(samples, 4, SR, 100)
    expect(chunks).toHaveLength(3)
    expect(chunks.map((c) => [c.startSample, Array.from(c.samples)])).toEqual([
      [100, [0, 1, 2, 3]],
      [104, [4, 5, 6, 7]],
      [108, [8, 9]],
    ])
    expect(chunks.every((c) => c.sampleRate === SR)).toBe(true)
  })

  it('rejects a non-positive chunk size', () => {
    expect(() => chunkSamples(new Float32Array(4), 0, SR)).toThrow(/chunkSize/)
  })
})

describe('frameCount', () => {
  it('matches hop arithmetic of the analyser', () => {
    expect(frameCount(2048, 2048, 480)).toBe(1)
    expect(frameCount(2048 + 480 * 9, 2048, 480)).toBe(10)
    expect(frameCount(2047, 2048, 480)).toBe(0)
  })
})
