import { describe, expect, it } from 'vitest'

import { createAnalyzer } from './analyzer'
import { formants } from './extractors/formants'
import { loudness } from './extractors/loudness'
import { vibrato } from './extractors/vibrato'
import { summarizeContour } from './contour-stats'
import { kWeightingGain } from '../dsp/k-weight'
import { LUFS_OFFSET } from '../dsp/lufs'
import { sinc } from '../dsp/interpolate'
import { formantTone, harmonicTone, sine, TEST_SAMPLE_RATE as SR } from '../testing/signals'

const FRAME = 2048

describe('vibrato extractor', () => {
  it('reads 6 Hz ±50 cents and undoes analysis-window attenuation', () => {
    const tone = harmonicTone({
      f0: 220,
      seconds: 1.4,
      vibrato: { rate: 6, extentCents: 50 },
    })
    const analyzer = createAnalyzer({ sampleRate: SR }, [vibrato])
    analyzer.push(tone.samples)
    const { timeline } = analyzer
    const index = timeline.frameAt(1.0)
    const rate = timeline.get('vibratoRate', index)
    const extent = timeline.get('vibratoExtent', index)
    expect(rate).toBeCloseTo(6, 0)
    expect(Math.abs(rate - 6)).toBeLessThan(0.6)
    expect(extent).toBeGreaterThan(35)
    expect(extent).toBeLessThan(70)
    const windowSeconds = FRAME / SR
    const raw = extent * sinc(rate * windowSeconds)
    expect(raw).toBeLessThan(extent)
  })

  it('stays silent on a steady sine', () => {
    const analyzer = createAnalyzer({ sampleRate: SR }, [vibrato])
    analyzer.push(sine({ frequency: 220, seconds: 1.2 }).samples)
    const index = analyzer.timeline.frameAt(1.0)
    expect(analyzer.timeline.get('vibratoRate', index)).toBeNaN()
    expect(analyzer.timeline.get('vibratoExtent', index)).toBeNaN()
  })
})

describe('formants extractor', () => {
  it('finds F1 and F2 of a synthetic /a/', () => {
    const vowel = formantTone({
      f0: 120,
      seconds: 0.8,
      amplitude: 0.4,
      formants: [
        { hz: 700, bw: 90 },
        { hz: 1200, bw: 90 },
        { hz: 2500, bw: 120 },
      ],
    })
    const analyzer = createAnalyzer({ sampleRate: SR }, [formants])
    analyzer.push(vowel.samples)
    const { timeline } = analyzer
    const index = timeline.frameAt(0.4)
    expect(timeline.get('f0', index)).toBeGreaterThan(100)
    const f1 = timeline.get('f1', index)
    const f2 = timeline.get('f2', index)
    expect(f1).toBeGreaterThan(500)
    expect(f1).toBeLessThan(900)
    expect(f2).toBeGreaterThan(1000)
    expect(f2).toBeLessThan(1500)
  })
})

describe('loudness extractor', () => {
  it('matches K-weighted closed form for a 1 kHz sine', () => {
    const amplitude = 0.5
    const analyzer = createAnalyzer({ sampleRate: SR }, [loudness])
    analyzer.push(sine({ frequency: 1000, seconds: 1.0, amplitude }).samples)
    const gain = kWeightingGain(SR, 1000)
    const expected =
      LUFS_OFFSET + 10 * Math.log10((amplitude * amplitude) / 2) + 20 * Math.log10(gain)
    const measured = analyzer.timeline.latest('lufsMomentary')
    expect(measured).toBeCloseTo(expected, 0)
    expect(Math.abs(measured - expected)).toBeLessThan(0.35)
  })
})

describe('summarizeContour', () => {
  it('averages finite contour columns', () => {
    const tone = harmonicTone({
      f0: 220,
      seconds: 1.3,
      vibrato: { rate: 6, extentCents: 40 },
    })
    const analyzer = createAnalyzer({ sampleRate: SR }, [vibrato, loudness])
    analyzer.push(tone.samples)
    const summary = summarizeContour(analyzer.timeline)
    expect(summary.voiced).toBeGreaterThan(50)
    expect(summary.vibratoRate).toBeGreaterThan(4)
    expect(summary.lufsMomentary).toBeLessThan(0)
  })
})
