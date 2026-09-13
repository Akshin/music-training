import { describe, expect, it } from 'vitest'

import { BeatGrid } from './beat-grid'

describe('BeatGrid', () => {
  const grid = new BeatGrid({ bpm: 120, meter: { beatsPerBar: 3, beatUnit: 4 }, origin: 1 })

  it('validates its inputs', () => {
    expect(() => new BeatGrid({ bpm: 0 })).toThrow(RangeError)
    expect(() => new BeatGrid({ bpm: 100, meter: { beatsPerBar: 0, beatUnit: 4 } })).toThrow(
      RangeError,
    )
  })

  it('defaults to 4/4 at origin 0', () => {
    const plain = new BeatGrid({ bpm: 60 })
    expect(plain.meter).toEqual({ beatsPerBar: 4, beatUnit: 4 })
    expect(plain.origin).toBe(0)
    expect(plain.secondsPerBeat).toBe(1)
    expect(plain.secondsPerBar).toBe(4)
  })

  it('converts beats and bars to seconds and back', () => {
    expect(grid.secondsPerBeat).toBe(0.5)
    expect(grid.beatToSeconds(0)).toBe(1)
    expect(grid.beatToSeconds(4)).toBe(3)
    expect(grid.secondsToBeat(3)).toBe(4)
    expect(grid.barToSeconds(2)).toBe(1 + 6 * 0.5)
  })

  it('locates bar, beat and phase', () => {
    expect(grid.positionAt(1)).toEqual({ bar: 0, beat: 0, phase: 0 })
    expect(grid.positionAt(1 + 0.5 * 4.5)).toEqual({ bar: 1, beat: 1, phase: 0.5 })
    expect(grid.positionAt(0.75)).toEqual({ bar: -1, beat: 2, phase: 0.5 })
  })

  it('finds the nearest beat with a signed offset', () => {
    const late = grid.nearestBeat(1 + 0.5 * 3 + 0.05)
    expect(late.beat).toBe(3)
    expect(late.offsetSeconds).toBeCloseTo(0.05, 12)
    expect(late.offsetBeats).toBeCloseTo(0.1, 12)
    const early = grid.nearestBeat(1 + 0.5 * 3 - 0.2)
    expect(early.beat).toBe(3)
    expect(early.offsetSeconds).toBeCloseTo(-0.2, 12)
  })

  it('derives grids with a new origin or tempo', () => {
    const moved = grid.withOrigin(10)
    expect(moved.beatToSeconds(2)).toBe(11)
    expect(moved.meter).toBe(grid.meter)
    expect(grid.withBpm(60).secondsPerBeat).toBe(1)
  })

  it('lists integer beats in a half-open time range', () => {
    expect(grid.beatsInRange(1, 2)).toEqual([0, 1])
    expect(grid.beatsInRange(1, 1)).toEqual([])
  })
})
