import { describe, expect, it } from 'vitest'
import {
  ANCHOR_LEVELS,
  HOLD_SECONDS,
  calibrationFault,
  heldLevel,
  inputKey,
  levelMap,
  looksBluetooth,
  steadySeconds,
  voiceFloorDb,
  type LevelSample,
  type LoudnessCalibration,
} from '@/training/calibration'

const calibration: LoudnessCalibration = { noise: -70, quiet: -48, comfortable: -36, loud: -24 }

/** A level held from time 0 to `seconds`, sampled at 60 Hz. */
function held(dbfs: number, seconds: number, wobble = 0): LevelSample[] {
  return Array.from({ length: Math.round(seconds * 60) + 1 }, (_, index) => ({
    time: index / 60,
    dbfs: dbfs + (index % 2 === 0 ? wobble : -wobble),
  }))
}

describe('levelMap', () => {
  it('is the plain −60…0 dBFS scale without a calibration', () => {
    const level = levelMap(null)
    expect(level(-60)).toBe(0)
    expect(level(-30)).toBeCloseTo(0.5)
    expect(level(0)).toBe(1)
    expect(level(-90)).toBe(0)
    expect(level(6)).toBe(1)
  })

  it('reads silence for anything that is not a finite number', () => {
    for (const level of [levelMap(null), levelMap(calibration)]) {
      expect(level(-Infinity)).toBe(0)
      expect(level(NaN)).toBe(0)
    }
  })

  it('puts the three notes on the centres of their zones', () => {
    const level = levelMap(calibration)
    expect(level(calibration.quiet)).toBeCloseTo(ANCHOR_LEVELS.quiet)
    expect(level(calibration.comfortable)).toBeCloseTo(ANCHOR_LEVELS.comfortable)
    expect(level(calibration.loud)).toBeCloseTo(ANCHOR_LEVELS.loud)
  })

  it('puts the same zone at the same height for a quiet and a loud device', () => {
    const quietDevice = levelMap({ noise: -80, quiet: -60, comfortable: -48, loud: -36 })
    const loudDevice = levelMap({ noise: -60, quiet: -34, comfortable: -22, loud: -10 })
    expect(quietDevice(-48)).toBeCloseTo(loudDevice(-22))
  })

  it('follows a device that squeezes the top: the zones stretch to its range', () => {
    const squeezed = levelMap({ noise: -70, quiet: -48, comfortable: -40, loud: -36 })
    // Half-way between comfortable and loud is half-way between their zone centres.
    expect(squeezed(-38)).toBeCloseTo((ANCHOR_LEVELS.comfortable + ANCHOR_LEVELS.loud) / 2)
  })

  it('rises with the level, and stays inside 0…1 beyond the notes', () => {
    const level = levelMap(calibration)
    let previous = -1
    for (let db = -100; db <= 10; db += 1) {
      const value = level(db)
      expect(value).toBeGreaterThanOrEqual(previous)
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThanOrEqual(1)
      previous = value
    }
    expect(level(-100)).toBe(0)
    expect(level(10)).toBe(1)
  })

  it('stays the plain scale when the notes are out of order', () => {
    const level = levelMap({ noise: -70, quiet: -30, comfortable: -40, loud: -20 })
    expect(level(-30)).toBeCloseTo(0.5)
  })
})

describe('voiceFloorDb', () => {
  it('is fixed without a calibration', () => {
    expect(voiceFloorDb(null)).toBe(-55)
  })

  it('sits just above the room, under the quiet note', () => {
    expect(voiceFloorDb({ noise: -75, quiet: -48, comfortable: -36, loud: -24 })).toBe(-65)
    // A noisy room: the gate is held under the quiet note.
    expect(voiceFloorDb({ noise: -50, quiet: -38, comfortable: -30, loud: -20 })).toBe(-42)
  })

  it('never goes under −70 dBFS', () => {
    expect(voiceFloorDb({ noise: -110, quiet: -48, comfortable: -36, loud: -24 })).toBe(-70)
  })
})

describe('calibrationFault', () => {
  it('accepts a proper calibration', () => {
    expect(calibrationFault(calibration)).toBeNull()
  })

  it('checks only what is measured', () => {
    expect(calibrationFault({})).toBeNull()
    expect(calibrationFault({ noise: -60 })).toBeNull()
    expect(calibrationFault({ noise: -60, quiet: -40 })).toBeNull()
  })

  it('finds a quiet note too close to the room', () => {
    expect(calibrationFault({ noise: -50, quiet: -45 })).toBe('noisy')
  })

  it('finds notes that are not louder than the one before', () => {
    expect(calibrationFault({ quiet: -40, comfortable: -39 })).toBe('order')
    expect(calibrationFault({ quiet: -40, comfortable: -30, loud: -29 })).toBe('order')
  })

  it('finds too small a range', () => {
    expect(calibrationFault({ quiet: -40, comfortable: -36, loud: -32 })).toBe('narrow')
  })
})

describe('heldLevel', () => {
  const floor = -58

  it('needs a full hold', () => {
    expect(heldLevel([], floor)).toBeNull()
    expect(heldLevel(held(-40, HOLD_SECONDS - 0.5), floor)).toBeNull()
    expect(heldLevel(held(-40, HOLD_SECONDS), floor)).toBeCloseTo(-40)
  })

  it('takes the median of a steady hold', () => {
    // A one-off spike does not move the median.
    const samples = held(-40, HOLD_SECONDS)
    samples[10] = { time: 10 / 60, dbfs: -38.5 }
    expect(heldLevel(samples, floor)).toBeCloseTo(-40)
  })

  it('does not count a level that wanders', () => {
    expect(heldLevel(held(-40, HOLD_SECONDS, 2.5), floor)).toBeNull()
  })

  it('looks only at the last seconds', () => {
    const before = held(-20, 3)
    const after = held(-40, HOLD_SECONDS).map((sample) => ({ ...sample, time: sample.time + 3.1 }))
    expect(heldLevel([...before, ...after], floor)).toBeCloseTo(-40)
  })

  it('does not count what is under the floor', () => {
    expect(heldLevel(held(-70, HOLD_SECONDS), floor)).toBeNull()
    expect(heldLevel(held(-Infinity, HOLD_SECONDS), floor)).toBeNull()
  })
})

describe('steadySeconds', () => {
  const floor = -58

  it('counts how long the level has been steady, up to the hold', () => {
    expect(steadySeconds([], floor)).toBe(0)
    expect(steadySeconds(held(-40, 1), floor)).toBeCloseTo(1)
    expect(steadySeconds(held(-40, 5), floor)).toBeCloseTo(HOLD_SECONDS)
  })

  it('starts over when the level jumps', () => {
    const before = held(-20, 1)
    const after = held(-40, 0.5).map((sample) => ({ ...sample, time: sample.time + 1.02 }))
    expect(steadySeconds([...before, ...after], floor)).toBeCloseTo(0.5)
  })

  it('is nothing under the floor', () => {
    expect(steadySeconds(held(-70, 2), floor)).toBe(0)
  })
})

describe('looksBluetooth', () => {
  it('knows headsets by name and by a narrow sample rate', () => {
    expect(looksBluetooth('AirPods Pro', 48000)).toBe(true)
    expect(looksBluetooth('Hands-Free Headset', 48000)).toBe(true)
    expect(looksBluetooth('USB Microphone', 16000)).toBe(true)
    expect(looksBluetooth('MacBook Pro Microphone', 48000)).toBe(false)
  })
})

describe('inputKey', () => {
  it('is the name of the input, else its id, else a default', () => {
    expect(inputKey('  AirPods Pro ', 'abc')).toBe('AirPods Pro')
    expect(inputKey('', 'abc')).toBe('abc')
    expect(inputKey('', undefined)).toBe('default')
  })
})
