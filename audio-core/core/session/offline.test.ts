import { describe, expect, it } from 'vitest'

import { createAnalyzer } from '../analysis/analyzer'
import { f0 } from '../analysis/extractors/f0'
import { pitch } from '../analysis/extractors/pitch'
import { sine, TEST_SAMPLE_RATE as SR } from '../testing/signals'
import { analyzeTape, analyzeWav, tapeToWav } from './offline'
import { decodeWav, encodeWav } from './wav'
import { PcmTape } from './pcm-tape'
import { Session } from './session'

describe('analyzeTape', () => {
  it('reproduces live f0 when the same PCM is analysed from a tape', () => {
    const { samples } = sine({ frequency: 220, seconds: 0.8, amplitude: 0.5 })
    const live = createAnalyzer({ sampleRate: SR }, [f0, pitch])
    live.push(samples)

    const tape = new PcmTape({ sampleRate: SR, hotSeconds: 0.3, chunkSeconds: 0.1 })
    tape.append(samples)
    const offline = analyzeTape(tape, [f0, pitch])

    expect(offline.timeline.length).toBe(live.timeline.length)
    const liveF0 = live.timeline.slice('f0')
    const tapeF0 = offline.timeline.slice('f0')
    let peakCents = 0
    for (let i = 0; i < liveF0.length; i++) {
      if (!Number.isFinite(liveF0[i]) || !Number.isFinite(tapeF0[i])) continue
      peakCents = Math.max(peakCents, Math.abs(1200 * Math.log2(tapeF0[i] / liveF0[i])))
    }
    expect(peakCents).toBeLessThan(1)
  })

  it('exports a WAV that decodes to the taped signal', () => {
    const { samples } = sine({ frequency: 330, seconds: 0.15, amplitude: 0.4 })
    const tape = new PcmTape({ sampleRate: SR, hotSeconds: 1, chunkSeconds: 0.5 })
    tape.append(samples)
    const decoded = decodeWav(tapeToWav(tape))
    expect(decoded.sampleRate).toBe(SR)
    expect(decoded.samples.length).toBe(samples.length)
  })
})

describe('Session', () => {
  it('records takes against the tape clock', () => {
    const tape = new PcmTape({ sampleRate: SR, hotSeconds: 1, chunkSeconds: 0.5 })
    const session = new Session(tape)
    session.beginTake('warmup')
    tape.append(sine({ frequency: 220, seconds: 0.2 }).samples)
    const closed = session.endTake()
    expect(closed.label).toBe('warmup')
    expect(closed.startSample).toBe(0)
    expect(closed.endSample).toBe(tape.length)
    expect(session.takes).toHaveLength(1)
  })
})

describe('analyzeWav', () => {
  it('matches a live pass over the same PCM', () => {
    const { samples } = sine({ frequency: 220, seconds: 0.5, amplitude: 0.5 })
    const live = createAnalyzer({ sampleRate: SR }, [f0, pitch])
    live.push(samples)
    const fromFile = analyzeWav(encodeWav(samples, SR), [f0, pitch])
    expect(fromFile.timeline.length).toBe(live.timeline.length)
    expect(fromFile.timeline.latest('note')).toBe(live.timeline.latest('note'))
  })
})
