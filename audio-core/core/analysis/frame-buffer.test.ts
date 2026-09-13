import { describe, expect, it } from 'vitest'

import { FrameBuffer } from './frame-buffer'

describe('FrameBuffer', () => {
  it('validates sizes', () => {
    expect(() => new FrameBuffer(0, 1)).toThrow(RangeError)
    expect(() => new FrameBuffer(8, 9)).toThrow(RangeError)
    expect(() => new FrameBuffer(8, 0)).toThrow(RangeError)
  })

  it('emits overlapping frames advancing by the hop', () => {
    const buffer = new FrameBuffer(4, 2)
    const frame = new Float32Array(4)
    buffer.write(new Float32Array([1, 2, 3]))
    expect(buffer.read(frame)).toBe(false)
    buffer.write(new Float32Array([4, 5, 6, 7]))
    expect(buffer.read(frame)).toBe(true)
    expect([...frame]).toEqual([1, 2, 3, 4])
    expect(buffer.read(frame)).toBe(true)
    expect([...frame]).toEqual([3, 4, 5, 6])
    expect(buffer.read(frame)).toBe(false)
    expect(buffer.available).toBe(3)
  })

  it('accepts sub-ranges and blocks larger than its initial capacity', () => {
    const buffer = new FrameBuffer(4, 4)
    const big = new Float32Array(100)
    for (let i = 0; i < 100; i++) big[i] = i
    buffer.write(big, 10, 90)
    const frame = new Float32Array(4)
    let frames = 0
    let first = -1
    while (buffer.read(frame)) {
      if (first < 0) first = frame[0]
      frames++
    }
    expect(first).toBe(10)
    expect(frames).toBe(20)
  })

  it('resets pending data', () => {
    const buffer = new FrameBuffer(4, 2)
    buffer.write(new Float32Array(10))
    buffer.reset()
    expect(buffer.available).toBe(0)
    expect(buffer.read(new Float32Array(4))).toBe(false)
  })
})
