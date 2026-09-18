import { describe, expect, it } from 'vitest'

import { createAnalyzer } from './analyzer'
import { harmonics } from './extractors/harmonics'
import { harmonicTone, sine, whiteNoise, TEST_SAMPLE_RATE as SR } from '../testing/signals'

/** Levels of h1…h3 in the middle of a 0.5 s signal. */
function measure(samples: Float32Array): number[] {
  const analyzer = createAnalyzer({ sampleRate: SR }, [harmonics])
  analyzer.push(samples)
  const { timeline } = analyzer
  const index = timeline.frameAt(0.25)
  return ['h1', 'h2', 'h3'].map((column) => timeline.get(column, index))
}

describe('harmonics', () => {
  it('reads the level of a sine as its fundamental', () => {
    const [h1] = measure(sine({ frequency: 330, seconds: 0.5, amplitude: 0.5 }).samples)
    expect(h1).toBeCloseTo(20 * Math.log10(0.5), 0)
  })

  it.each([98, 220, 440, 880])('keeps the ratios of partials at %d Hz', (f0) => {
    const partials = [1, 0.5, 0.25, 0.1]
    const [h1, h2, h3] = measure(harmonicTone({ f0, seconds: 0.5, partials }).samples)
    expect(h2! - h1!).toBeCloseTo(20 * Math.log10(0.5), 0)
    expect(h3! - h1!).toBeCloseTo(20 * Math.log10(0.25), 0)
  })

  it('sees a missing third partial', () => {
    const [h1, , h3] = measure(
      harmonicTone({ f0: 220, seconds: 0.5, partials: [1, 0.6, 0.003, 0.3] }).samples,
    )
    expect(h3! - h1!).toBeLessThan(-40)
  })

  it('writes NaN when unvoiced', () => {
    const levels = measure(whiteNoise({ seconds: 0.5, amplitude: 0.4, seed: 5 }))
    for (const level of levels) expect(level).toBeNaN()
  })
})
