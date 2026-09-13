import { describe, expect, it } from 'vitest'

import { createAnalyzer } from './analyzer'
import { cpp } from './extractors/cpp'
import { f0 } from './extractors/f0'
import { loudness } from './extractors/loudness'
import { onset } from './extractors/onset'
import { pitch } from './extractors/pitch'
import { relativeGated } from '../dsp/lufs'
import {
  harmonicTone,
  noteSequence,
  seq,
  sine,
  whiteNoise,
  TEST_SAMPLE_RATE as SR,
} from '../testing/signals'

describe('pYIN tracker', () => {
  it('tracks a 440 Hz sine after the Viterbi delay', () => {
    const analyzer = createAnalyzer({ sampleRate: SR }, [pitch], { f0: { tracker: 'pyin' } })
    analyzer.push(sine({ frequency: 440, seconds: 0.8 }).samples)
    const { timeline } = analyzer
    const index = timeline.frameAt(0.4)
    expect(timeline.get('note', index)).toBe(69)
    expect(Math.abs(timeline.get('cents', index))).toBeLessThan(2)
    expect(timeline.get('f0', index)).toBeCloseTo(440, 0)
  })

  it('stays unvoiced on white noise', () => {
    const analyzer = createAnalyzer({ sampleRate: SR }, [f0], { f0: { tracker: 'pyin' } })
    analyzer.push(whiteNoise({ seconds: 0.6, amplitude: 0.4, seed: 3 }))
    const index = analyzer.timeline.frameAt(0.4)
    expect(analyzer.timeline.get('f0', index)).toBeNaN()
  })
})

describe('cpp', () => {
  it('is high on a harmonic tone and low on noise', () => {
    const tone = createAnalyzer({ sampleRate: SR }, [cpp])
    tone.push(harmonicTone({ f0: 220, seconds: 0.5, harmonics: 8 }).samples)
    const noise = createAnalyzer({ sampleRate: SR }, [cpp])
    noise.push(whiteNoise({ seconds: 0.5, amplitude: 0.4, seed: 9 }))
    const toneCpp = tone.timeline.latest('cpp')
    const noiseCpp = noise.timeline.latest('cpp')
    expect(toneCpp).toBeGreaterThan(5)
    expect(Number.isFinite(noiseCpp) ? noiseCpp : 0).toBeLessThan(toneCpp - 4)
  })
})

describe('relative LUFS gate', () => {
  it('drops blocks more than 10 LU below the absolute-gated mean', () => {
    const blocks = Float64Array.from([-20, -20, -20, -20, -45])
    const gated = relativeGated(blocks, blocks.length)
    expect(gated).toBeGreaterThan(-22)
    expect(gated).toBeLessThan(-18)
  })

  it('writes lufsIntegrated on a 1 kHz sine', () => {
    const analyzer = createAnalyzer({ sampleRate: SR }, [loudness])
    analyzer.push(sine({ frequency: 1000, seconds: 1.2, amplitude: 0.5 }).samples)
    const integrated = analyzer.timeline.latest('lufsIntegrated')
    const momentary = analyzer.timeline.latest('lufsMomentary')
    expect(Number.isFinite(integrated)).toBe(true)
    expect(Math.abs(integrated - momentary)).toBeLessThan(1)
  })
})

describe('superflux onset', () => {
  it('peaks at note attacks in a phrase with pauses', () => {
    const phrase = noteSequence([seq.note(60, 0.25), seq.pause(0.25), seq.note(64, 0.25)])
    const analyzer = createAnalyzer({ sampleRate: SR }, [onset])
    analyzer.push(phrase.samples)
    const { timeline } = analyzer
    let attack = 0
    let pause = 0
    for (let i = 5; i < timeline.length; i++) {
      const time = timeline.frameTime(i)
      const value = timeline.get('onsetStrength', i)
      if (time < 0.22) attack = Math.max(attack, value)
      if (time > 0.3 && time < 0.48) pause = Math.max(pause, value)
    }
    expect(attack).toBeGreaterThan(pause * 1.4)
  })
})
