import { describe, expect, it } from 'vitest'

import { Yin } from '../dsp/yin'
import { hzToMidi } from '../model/pitch'
import { harmonicTone, whiteNoise, TEST_SAMPLE_RATE } from '../testing/signals'
import { shiftPitch } from './pitch-shift'

const RATE = 100
const SECONDS = 0.6

/** Frames of `value(t)` at 100 per second over the signal. */
function frames(value: (t: number) => number): Float32Array {
  return Float32Array.from({ length: Math.round(SECONDS * RATE) + 1 }, (_, i) => value(i / RATE))
}

/** f0 of the signal around `t` seconds. */
function f0At(samples: Float32Array, t: number): number {
  const yin = new Yin({ frameSize: 2048, sampleRate: TEST_SAMPLE_RATE })
  const start = Math.round(t * TEST_SAMPLE_RATE)
  return yin.detect(samples.subarray(start, start + 2048)).frequency
}

function rms(samples: Float32Array, from: number, to: number): number {
  let sum = 0
  for (let i = from; i < to; i++) sum += samples[i] * samples[i]
  return Math.sqrt(sum / (to - from))
}

describe('shiftPitch', () => {
  const tone = harmonicTone({ f0: 220, seconds: SECONDS, harmonics: 10 })
  const pitch = frames(() => hzToMidi(220))
  const spec = { sampleRate: TEST_SAMPLE_RATE, frameRate: RATE, frameStart: 0, pitch }

  it('gives the voice back as it was when nothing moves', () => {
    const out = shiftPitch(tone.samples, { ...spec, shift: frames(() => 0) })
    let worst = 0
    for (let i = 2000; i < tone.samples.length - 2000; i++) {
      worst = Math.max(worst, Math.abs(out[i] - tone.samples[i]))
    }
    expect(worst).toBeLessThan(1e-5)
  })

  it('moves the voice up and down by semitones, keeping its loudness', () => {
    for (const semitones of [2, -3]) {
      const out = shiftPitch(tone.samples, { ...spec, shift: frames(() => semitones) })
      const expected = 220 * 2 ** (semitones / 12)
      expect(Math.abs(f0At(out, 0.25) - expected) / expected).toBeLessThan(0.01)
      const ratio = rms(out, 4800, 24000) / rms(tone.samples, 4800, 24000)
      expect(ratio).toBeGreaterThan(0.85)
      expect(ratio).toBeLessThan(1.15)
    }
  })

  it('leaves unvoiced stretches as they are', () => {
    const noise = whiteNoise({ seconds: SECONDS, amplitude: 0.3 })
    const out = shiftPitch(noise, { ...spec, pitch: frames(() => NaN), shift: frames(() => 5) })
    let worst = 0
    for (let i = 1000; i < noise.length - 1000; i++) {
      worst = Math.max(worst, Math.abs(out[i] - noise[i]))
    }
    expect(worst).toBeLessThan(1e-5)
  })

  it('takes vibrato away when each moment is moved back to the centre', () => {
    const wobbly = harmonicTone({
      f0: 220,
      seconds: SECONDS,
      harmonics: 10,
      vibrato: { rate: 6, extentCents: 60 },
    })
    const sung = frames((t) => hzToMidi(wobbly.frequencyAt(t)))
    const out = shiftPitch(wobbly.samples, {
      ...spec,
      pitch: sung,
      shift: sung.map((midi) => hzToMidi(220) - midi),
    })
    const heard = [0.15, 0.2, 0.25, 0.3, 0.35, 0.4].map((t) => f0At(out, t))
    const before = [0.15, 0.2, 0.25, 0.3, 0.35, 0.4].map((t) => f0At(wobbly.samples, t))
    const spread = (values: number[]) => Math.max(...values) - Math.min(...values)
    expect(spread(heard)).toBeLessThan(spread(before) / 3)
  })
})
