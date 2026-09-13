import { describe, expect, it } from 'vitest'

import { metronomeClicks } from '../synthesis/metronome'
import { BeatGrid } from './beat-grid'
import { TempoMap } from './tempo-map'

const clicks = (map: TempoMap, from: number, to: number) =>
  map.windows(from, to).flatMap((w) => metronomeClicks(w.grid, w.from, w.to))

describe('TempoMap', () => {
  it('changes tempo on the next beat and keeps counting bars', () => {
    const map = new TempoMap(new BeatGrid({ bpm: 120 }))
    expect(map.change(0.7, { bpm: 60 })).toBe(1)
    expect(clicks(map, 0, 4).map((c) => c.time)).toEqual([0, 0.5, 1, 2, 3])
    expect(map.positionAt(0.99)).toMatchObject({ epoch: 0, bar: 0, beat: 1 })
    expect(map.positionAt(3)).toMatchObject({ epoch: 0, bar: 1, beat: 0, phase: 0 })
  })

  it('never repeats a beat when the tempo speeds up', () => {
    const map = new TempoMap(new BeatGrid({ bpm: 60 }))
    expect(map.change(0.2, { bpm: 120 })).toBe(1)
    expect(clicks(map, 0, 2).map((c) => c.time)).toEqual([0, 1, 1.5])
  })

  it('starts a new epoch on a downbeat when the meter changes', () => {
    const map = new TempoMap(new BeatGrid({ bpm: 120 }))
    expect(map.change(0.7, { bpm: 120, meter: { beatsPerBar: 3, beatUnit: 4 } })).toBe(1)
    expect(clicks(map, 0, 3).map((c) => [c.time, c.level])).toEqual([
      [0, 'bar'],
      [0.5, 'beat'],
      [1, 'bar'],
      [1.5, 'beat'],
      [2, 'beat'],
      [2.5, 'bar'],
    ])
    expect(map.positionAt(0.99).epoch).toBe(0)
    expect(map.positionAt(1)).toMatchObject({ epoch: 1, bar: 0, beat: 0 })
    expect(map.windows(0, 3).map((w) => [w.from, w.epoch])).toEqual([
      [0, 0],
      [1, 1],
    ])
  })

  it('drops pending changes so a dragged knob lands once', () => {
    const map = new TempoMap(new BeatGrid({ bpm: 120 }))
    map.change(0.7, { bpm: 60 })
    expect(map.change(0.8, { bpm: 90 })).toBe(1)
    expect(map.windows(0, 2).map((w) => w.grid.bpm)).toEqual([120, 90])
    expect(map.change(0.9, { bpm: 120 })).toBeUndefined()
    expect(map.windows(0, 2).map((w) => w.grid.bpm)).toEqual([120])
  })

  it('prunes segments that are over', () => {
    const map = new TempoMap(new BeatGrid({ bpm: 120 }))
    map.change(0.7, { bpm: 60 })
    map.prune(0.5)
    expect(map.windows(0, 2)).toHaveLength(2)
    map.prune(1.5)
    expect(map.windows(1, 2).map((w) => w.grid.bpm)).toEqual([60])
  })
})
