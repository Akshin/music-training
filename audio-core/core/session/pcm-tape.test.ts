import { describe, expect, it } from 'vitest'

import { INT16_MAX, decodeInt16, encodeInt16 } from './pcm'
import { MemoryColdStore, PcmTape } from './pcm-tape'
import { decodeWav, encodeWav } from './wav'
import { sine, TEST_SAMPLE_RATE as SR, toChunks } from '../testing/signals'

describe('int16 codec', () => {
  it('round-trips full-scale and silence', () => {
    const source = new Float32Array([0, 1, -1, 0.5, -0.25])
    const back = decodeInt16(encodeInt16(source))
    expect(back[0]).toBe(0)
    expect(back[1]).toBe(1)
    expect(back[2]).toBe(-1)
    expect(Math.abs(back[3] - 0.5)).toBeLessThan(2 / INT16_MAX)
    expect(Math.abs(back[4] + 0.25)).toBeLessThan(2 / INT16_MAX)
  })

  it('clips past full scale', () => {
    const pcm = encodeInt16(new Float32Array([2, -3]))
    expect(Array.from(pcm)).toEqual([INT16_MAX, -INT16_MAX])
  })
})

describe('WAV', () => {
  it('round-trips a sine through 16-bit PCM', () => {
    const { samples } = sine({ frequency: 440, seconds: 0.2, amplitude: 0.4 })
    const wav = encodeWav(samples, SR)
    const decoded = decodeWav(wav)
    expect(decoded.sampleRate).toBe(SR)
    expect(decoded.channels).toBe(1)
    expect(decoded.samples.length).toBe(samples.length)
    let peak = 0
    for (let i = 0; i < samples.length; i++) {
      peak = Math.max(peak, Math.abs(decoded.samples[i] - samples[i]))
    }
    expect(peak).toBeLessThan(2 / INT16_MAX)
  })

  it('rejects non-PCM files', () => {
    expect(() => decodeWav(new ArrayBuffer(12))).toThrow(/truncated/)
  })
})

describe('PcmTape', () => {
  it('reads back what was appended, including across chunk boundaries', () => {
    const tape = new PcmTape({ sampleRate: SR, hotSeconds: 0.05, chunkSeconds: 0.02 })
    const { samples } = sine({ frequency: 220, seconds: 0.2, amplitude: 0.5 })
    for (const chunk of toChunks(samples, 512)) tape.append(chunk.samples, chunk.startSample)

    expect(tape.length).toBe(samples.length)
    expect(tape.getStats().coldChunks).toBeGreaterThan(0)

    const hot = tape.read(tape.length - 1000, 1000)
    const expectedHot = samples.subarray(samples.length - 1000)
    expectMaxError(hot, expectedHot, 0)

    const cold = tape.read(0, 2000)
    expectMaxError(cold, samples.subarray(0, 2000), 2 / INT16_MAX)
  })

  it('zero-fills gaps and drops overlaps so the clock matches the analyser', () => {
    const tape = new PcmTape({ sampleRate: SR, hotSeconds: 1, chunkSeconds: 0.5 })
    const block = new Float32Array(1000).fill(0.1)
    tape.append(block, 0)
    tape.append(block, 1500)
    expect(tape.length).toBe(2500)
    expect(tape.getStats().gapSamples).toBe(500)
    const gap = tape.read(1000, 500)
    expect(peakAbs(gap)).toBe(0)

    tape.append(block, 2400)
    expect(tape.getStats().overlapSamples).toBe(100)
    expect(tape.length).toBe(2500 + 900)
  })

  it('useCold migrates flushed chunks', () => {
    const tape = new PcmTape({ sampleRate: SR, hotSeconds: 0.05, chunkSeconds: 0.02 })
    tape.append(sine({ frequency: 100, seconds: 0.1 }).samples)
    const flushed = tape.getStats().coldChunks
    expect(flushed).toBeGreaterThan(0)
    const next = new MemoryColdStore(tape.chunkSamples)
    tape.useCold(next)
    expect(tape.getStats().backend).toBe('memory')
    expect(next.chunkCount).toBe(flushed)
    const roundtrip = tape.read(0, tape.chunkSamples)
    expect(peakAbs(roundtrip)).toBeGreaterThan(0.05)
  })
})

function expectMaxError(actual: Float32Array, expected: ArrayLike<number>, max: number): void {
  let peak = 0
  for (let i = 0; i < actual.length; i++) peak = Math.max(peak, Math.abs(actual[i] - expected[i]))
  expect(peak).toBeLessThanOrEqual(max)
}

function peakAbs(samples: Float32Array): number {
  let peak = 0
  for (let i = 0; i < samples.length; i++) peak = Math.max(peak, Math.abs(samples[i]))
  return peak
}
