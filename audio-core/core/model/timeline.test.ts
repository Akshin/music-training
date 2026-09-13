import { describe, expect, it } from 'vitest'

import { Column, Timeline } from './timeline'

const spec = { sampleRate: 48000, hopSize: 480, originSample: 1024, columns: ['f0', 'rms'] }

describe('Column', () => {
  it('requires a power-of-two block size', () => {
    expect(() => new Column('x', 3)).toThrow(RangeError)
  })

  it('reads NaN where nothing was written and copies across block boundaries', () => {
    const column = new Column('x', 4)
    expect(column.get(0)).toBeNaN()
    expect(column.get(1000)).toBeNaN()
    for (let i = 0; i < 10; i++) column.set(i, i * 10)
    const out = new Float32Array(8)
    column.copyTo(out, 2, 10)
    expect([...out]).toEqual([20, 30, 40, 50, 60, 70, 80, 90])
    const beyond = new Float32Array(4)
    column.copyTo(beyond, 9, 13)
    expect(beyond[0]).toBe(90)
    expect(beyond[1]).toBeNaN()
    expect(beyond[3]).toBeNaN()
  })
})

describe('Timeline', () => {
  it('maps frames to session time using the window centre', () => {
    const timeline = new Timeline(spec)
    expect(timeline.frameRate).toBe(100)
    expect(timeline.frameDuration).toBeCloseTo(0.01, 12)
    expect(timeline.frameTime(0)).toBeCloseTo(1024 / 48000, 12)
    expect(timeline.frameTime(100)).toBeCloseTo((1024 + 48000) / 48000, 12)
    expect(timeline.frameAt(timeline.frameTime(7))).toBe(7)
    expect(timeline.frameAt(timeline.frameTime(7) + 0.0099)).toBe(7)
    expect(timeline.frameAt(0)).toBeLessThan(0)
  })

  it('appends frames as NaN and stores values per column', () => {
    const timeline = new Timeline(spec)
    expect(timeline.length).toBe(0)
    expect(timeline.latest('f0')).toBeNaN()
    const index = timeline.append()
    expect(index).toBe(0)
    expect(timeline.get('f0', 0)).toBeNaN()
    timeline.set('f0', 0, 440)
    timeline.set('rms', 0, 0.1)
    expect(timeline.get('f0', 0)).toBe(440)
    expect(timeline.latest('rms')).toBeCloseTo(0.1, 6)
    expect(() => timeline.set('f0', 1, 1)).toThrow(RangeError)
    expect(() => timeline.get('nope', 0)).toThrow(/Unknown timeline column/)
  })

  it('rejects duplicate columns', () => {
    expect(() => new Timeline({ ...spec, columns: ['a', 'a'] })).toThrow(/Duplicate/)
  })

  it('slices across storage blocks and clamps to the stored length', () => {
    const timeline = new Timeline({ ...spec, blockFrames: 4 })
    for (let i = 0; i < 10; i++) {
      timeline.append()
      timeline.set('f0', i, 100 + i)
    }
    expect(Array.from(timeline.slice('f0', 2, 7))).toEqual([102, 103, 104, 105, 106])
    expect(Array.from(timeline.slice('f0', 8, 20))).toEqual([108, 109])
    expect(timeline.slice('f0').length).toBe(10)
    const reused = new Float32Array(3)
    expect(timeline.slice('f0', 0, 3, reused)).toBe(reused)
  })

  it('appends batches column-wise, leaving missing columns NaN', () => {
    const timeline = new Timeline(spec)
    timeline.append()
    const first = timeline.appendBatch(3, { f0: [1, 2, 3] })
    expect(first).toBe(1)
    expect(timeline.length).toBe(4)
    expect(Array.from(timeline.slice('f0', 1))).toEqual([1, 2, 3])
    expect(timeline.get('rms', 3)).toBeNaN()
    expect(() => timeline.appendBatch(3, { f0: [1] })).toThrow(RangeError)
  })

  it('resolves time ranges to clamped frame ranges', () => {
    const timeline = new Timeline(spec)
    for (let i = 0; i < 50; i++) timeline.append()
    const t = (i: number): number => timeline.frameTime(i)
    expect(timeline.range(t(10), t(20))).toEqual({ start: 10, end: 21 })
    expect(timeline.range(-1, t(2))).toEqual({ start: 0, end: 3 })
    expect(timeline.range(t(45), 100)).toEqual({ start: 45, end: 50 })
    expect(timeline.range(200, 300)).toEqual({ start: 50, end: 50 })
  })
})
