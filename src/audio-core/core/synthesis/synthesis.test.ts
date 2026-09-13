import { describe, expect, it } from 'vitest'

import { BeatGrid } from '../clock/beat-grid'
import { midiToHz } from '../model/pitch'
import { renderClick } from './click'
import { metronomeClicks } from './metronome'
import { majorArpeggio, referenceTriggers } from './reference'
import { renderTone } from './tone'

describe('renderClick / renderTone', () => {
  it('accent click is louder and longer-tailed than a regular tick', () => {
    const accent = renderClick(48000, true)
    const tick = renderClick(48000, false)
    expect(accent.length).toBe(tick.length)
    const peak = (samples: Float32Array) => {
      let max = 0
      for (let i = 0; i < samples.length; i++) max = Math.max(max, Math.abs(samples[i]))
      return max
    }
    expect(peak(accent)).toBeGreaterThan(peak(tick))
    expect(peak(accent)).toBeLessThanOrEqual(1)
  })

  it('tone peaks at the requested MIDI and fades at the edges', () => {
    const sampleRate = 48000
    const samples = renderTone(sampleRate, 69, 0.1, 0.5)
    expect(samples[0]).toBe(0)
    expect(samples[samples.length - 1]).toBe(0)
    let peak = 0
    for (let i = 0; i < samples.length; i++) peak = Math.max(peak, Math.abs(samples[i]))
    expect(peak).toBeCloseTo(0.5, 2)
    // A4 = 440 Hz: one period is 48000/440 samples; zero crossings ~ twice per period.
    const period = sampleRate / midiToHz(69)
    expect(period).toBeCloseTo(sampleRate / 440, 8)
  })
})

describe('metronomeClicks', () => {
  it('accents beat 0 of every bar', () => {
    const grid = new BeatGrid({ bpm: 120, meter: { beatsPerBar: 3, beatUnit: 4 } })
    const clicks = metronomeClicks(grid, 0, grid.secondsPerBar * 2)
    expect(clicks).toHaveLength(6)
    expect(clicks.filter((c) => c.accent).map((c) => c.beat)).toEqual([0, 3])
    expect(clicks.map((c) => c.beatInBar)).toEqual([0, 1, 2, 0, 1, 2])
    expect(clicks[1].time).toBeCloseTo(0.5, 12)
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
