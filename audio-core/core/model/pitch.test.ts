import { describe, expect, it } from 'vitest'

import { centsBetween, centsOffNearest, hzToMidi, midiToHz, nearestMidi, noteName } from './pitch'

describe('pitch conversions', () => {
  it('maps A4 = 440 Hz to MIDI 69 and back', () => {
    expect(hzToMidi(440)).toBeCloseTo(69, 12)
    expect(midiToHz(69)).toBeCloseTo(440, 12)
    expect(midiToHz(60)).toBeCloseTo(261.6256, 3)
    expect(hzToMidi(midiToHz(53.7))).toBeCloseTo(53.7, 10)
  })

  it('honours an alternative tuning reference', () => {
    expect(hzToMidi(442, 442)).toBeCloseTo(69, 12)
    expect(centsBetween(440, 442)).toBeCloseTo(-7.85, 2)
  })

  it('measures cents and the offset from the nearest note', () => {
    expect(centsBetween(880, 440)).toBeCloseTo(1200, 12)
    expect(nearestMidi(69.4)).toBe(69)
    expect(nearestMidi(69.6)).toBe(70)
    expect(centsOffNearest(69.25)).toBeCloseTo(25, 12)
    expect(centsOffNearest(69.75)).toBeCloseTo(-25, 12)
  })

  it('propagates NaN for unvoiced input', () => {
    expect(hzToMidi(NaN)).toBeNaN()
    expect(nearestMidi(NaN)).toBeNaN()
    expect(centsOffNearest(NaN)).toBeNaN()
  })

  it('names notes scientifically', () => {
    expect(noteName(69)).toBe('A4')
    expect(noteName(60)).toBe('C4')
    expect(noteName(61)).toBe('C#4')
    expect(noteName(21)).toBe('A0')
    expect(noteName(0)).toBe('C-1')
    expect(noteName(69.4)).toBe('A4')
  })
})
