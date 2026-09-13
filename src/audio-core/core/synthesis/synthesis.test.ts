import { describe, expect, it } from 'vitest'

import { BeatGrid } from '../clock/beat-grid'
import { midiToHz } from '../model/pitch'
import { renderClick } from './click'
import { metronomeClicks } from './metronome'
import { majorArpeggio, referenceTriggers } from './reference'
import { renderTone, TONE_RELEASE_SECONDS } from './tone'

describe('renderClick / renderTone', () => {
  it('downbeat is louder than a group accent, which is louder than a regular tick', () => {
    const bar = renderClick(48000, 'bar')
    const group = renderClick(48000, 'group')
    const tick = renderClick(48000, 'beat')
    expect(bar.length).toBe(tick.length)
    const peak = (samples: Float32Array) => {
      let max = 0
      for (let i = 0; i < samples.length; i++) max = Math.max(max, Math.abs(samples[i]))
      return max
    }
    expect(peak(bar)).toBeGreaterThan(peak(group))
    expect(peak(group)).toBeGreaterThan(peak(tick))
    expect(peak(bar)).toBeLessThanOrEqual(1)
  })

  it('tone starts and ends silent, peaks at its velocity and rings past its written length', () => {
    const sampleRate = 48000
    const samples = renderTone(sampleRate, 69, 0.1, 0.5)
    expect(samples[0]).toBe(0)
    expect(samples[samples.length - 1]).toBe(0)
    expect(samples.length).toBe(Math.round(sampleRate * 0.1) + sampleRate * TONE_RELEASE_SECONDS)
    let peak = 0
    for (let i = 0; i < samples.length; i++) peak = Math.max(peak, Math.abs(samples[i]))
    expect(peak).toBeCloseTo(0.5, 2)
  })

  it('tone is bright on the attack, settles onto its fundamental and decays', () => {
    const sampleRate = 48000
    const hz = midiToHz(69)
    const samples = renderTone(sampleRate, 69, 1, 0.5)
    // Magnitude of one frequency over 50 ms — whole periods of both 440 and 880 Hz.
    const span = 2400
    const magnitude = (from: number, f: number) => {
      const w = (2 * Math.PI * f) / sampleRate
      let re = 0
      let im = 0
      for (let i = from; i < from + span; i++) {
        re += samples[i] * Math.cos(w * i)
        im += samples[i] * Math.sin(w * i)
      }
      return Math.hypot(re, im)
    }
    const brightness = (from: number) => magnitude(from, 2 * hz) / magnitude(from, hz)
    const body = sampleRate * 0.4
    expect(brightness(0)).toBeGreaterThan(2 * brightness(body))
    expect(brightness(body)).toBeLessThan(0.3)
    expect(magnitude(sampleRate * 0.8, hz)).toBeLessThan(magnitude(sampleRate * 0.1, hz))
  })
})

describe('metronomeClicks', () => {
  it('accents beat 0 of every bar', () => {
    const grid = new BeatGrid({ bpm: 120, meter: { beatsPerBar: 3, beatUnit: 4 } })
    const clicks = metronomeClicks(grid, 0, grid.secondsPerBar * 2)
    expect(clicks).toHaveLength(6)
    expect(clicks.filter((c) => c.level === 'bar').map((c) => c.beat)).toEqual([0, 3])
    expect(clicks.map((c) => c.beatInBar)).toEqual([0, 1, 2, 0, 1, 2])
    expect(clicks[1].time).toBeCloseTo(0.5, 12)
  })

  it('feels 6/8 in two groups of three eighths', () => {
    const grid = new BeatGrid({ bpm: 180, meter: { beatsPerBar: 6, beatUnit: 8 } })
    const clicks = metronomeClicks(grid, 0, grid.secondsPerBar)
    expect(clicks.map((c) => c.level)).toEqual(['bar', 'beat', 'beat', 'group', 'beat', 'beat'])
  })

  it('keeps simple meters and 3/8 in a single group', () => {
    for (const meter of [
      { beatsPerBar: 6, beatUnit: 4 },
      { beatsPerBar: 3, beatUnit: 8 },
    ]) {
      const grid = new BeatGrid({ bpm: 120, meter })
      const levels = metronomeClicks(grid, 0, grid.secondsPerBar).map((c) => c.level)
      expect(levels.filter((level) => level !== 'beat')).toEqual(['bar'])
    }
  })
})

describe('referenceTriggers', () => {
  it('emits on/off on the grid and keeps tempo with the metronome', () => {
    const grid = new BeatGrid({ bpm: 60 })
    const notes = majorArpeggio()
    const clicks = metronomeClicks(grid, 0, 4)
    const triggers = referenceTriggers(grid, notes, 0, 5)
    expect(notes.map((n) => n.midi)).toEqual([60, 64, 67, 72])
    expect(triggers.filter((t) => t.kind === 'on').map((t) => t.time)).toEqual(
      clicks.slice(0, 4).map((c) => c.time),
    )
    expect(triggers.filter((t) => t.kind === 'off').at(-1)?.time).toBe(4)
  })

  it('clips to the requested window', () => {
    const grid = new BeatGrid({ bpm: 60 })
    const triggers = referenceTriggers(grid, majorArpeggio(), 1.5, 2.5)
    expect(triggers.map((t) => [t.kind, t.note.midi])).toEqual([
      ['off', 64],
      ['on', 67],
    ])
  })
})
