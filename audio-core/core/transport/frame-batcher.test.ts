import { describe, expect, it } from 'vitest'

import { createAnalyzer, resolveAnalysisContext } from '../analysis/analyzer'
import { level } from '../analysis/extractors/level'
import { pitch } from '../analysis/extractors/pitch'
import { spectrum } from '../analysis/extractors/spectrum'
import { collectColumns, resolveExtractors } from '../analysis/graph'
import { resolveFeatureIds } from '../analysis/registry'
import { Timeline } from '../model/timeline'
import { sine, TEST_SAMPLE_RATE, toChunks } from '../testing/signals'
import { FrameBatcher } from './frame-batcher'
import type { FramesMessage } from './protocol'
import { TimelineMirror } from './timeline-mirror'

/** Simulates `postMessage` with a transfer list: the receiver gets fresh buffers, the sender's detach. */
function transferMessage(message: FramesMessage, transfer: ArrayBuffer[]): FramesMessage {
  return structuredClone(message, { transfer })
}

function mirrorFor(features: readonly string[], sampleRate = TEST_SAMPLE_RATE): TimelineMirror {
  const extractors = resolveExtractors(resolveFeatureIds(features))
  const context = resolveAnalysisContext({ sampleRate })
  return new TimelineMirror(
    new Timeline({
      sampleRate,
      hopSize: context.hopSize,
      originSample: context.frameSize / 2,
      columns: collectColumns(extractors),
    }),
  )
}

describe('FrameBatcher + TimelineMirror', () => {
  it('reproduces the analyser timeline on the receiving side, batch by batch', () => {
    const analyzer = createAnalyzer({ sampleRate: TEST_SAMPLE_RATE }, [pitch, level])
    const batcher = new FrameBatcher(analyzer, { capacity: 16 })
    const mirror = mirrorFor(['pitch', 'level'])

    const signal = sine({ frequency: 220, seconds: 1.0 })
    let batches = 0
    for (const chunk of toChunks(signal.samples, 512)) {
      analyzer.push(chunk)
      for (let batch = batcher.take(); batch !== null; batch = batcher.take()) {
        expect(batch.message.count).toBeLessThanOrEqual(16)
        const received = transferMessage(batch.message, batch.transfer)
        for (const buffer of batch.transfer) expect(buffer.detached).toBe(true)
        mirror.apply(received)
        batches++
      }
    }

    expect(batcher.pending).toBe(0)
    expect(batches).toBeGreaterThan(0)
    const source = analyzer.timeline
    const copy = mirror.timeline
    expect(copy.length).toBe(source.length)
    expect(copy.columns).toEqual(source.columns)
    for (const name of source.columns) {
      expect(Array.from(copy.slice(name))).toEqual(Array.from(source.slice(name)))
    }
    expect(copy.frameTime(10)).toBe(source.frameTime(10))
  })

  it('returns null when everything has been shipped', () => {
    const analyzer = createAnalyzer({ sampleRate: TEST_SAMPLE_RATE }, [level])
    const batcher = new FrameBatcher(analyzer)
    expect(batcher.take()).toBeNull()
    analyzer.push(sine({ frequency: 440, seconds: 0.1 }).samples)
    expect(batcher.take()).not.toBeNull()
    expect(batcher.take()).toBeNull()
  })

  it('reuses recycled buffers instead of allocating', () => {
    const analyzer = createAnalyzer({ sampleRate: TEST_SAMPLE_RATE }, [level])
    const batcher = new FrameBatcher(analyzer, { capacity: 8 })
    const mirror = mirrorFor(['level'])

    for (const chunk of toChunks(sine({ frequency: 440, seconds: 2 }).samples, 1024)) {
      analyzer.push(chunk)
      for (let batch = batcher.take(); batch !== null; batch = batcher.take()) {
        const returned = mirror.apply(transferMessage(batch.message, batch.transfer))
        // Round-trip the buffers back, as the host's `recycle-frames` message would.
        batcher.recycle(structuredClone(returned, { transfer: returned }))
      }
    }

    const stats = batcher.getStats()
    expect(stats.columns.allocated).toBe(analyzer.timeline.columns.length)
    expect(stats.columns.free).toBe(analyzer.timeline.columns.length)
  })

  it('attaches the latest spectrum when a provider is given', () => {
    const analyzer = createAnalyzer({ sampleRate: TEST_SAMPLE_RATE }, [spectrum, level])
    const batcher = new FrameBatcher(analyzer, {
      capacity: 32,
      spectrum: () =>
        analyzer.results.has(spectrum) ? analyzer.results.get(spectrum).magnitude : undefined,
    })
    const mirror = mirrorFor(['spectrum', 'level'])

    analyzer.push(sine({ frequency: 1000, seconds: 0.5 }).samples)
    const batch = batcher.take()
    expect(batch).not.toBeNull()
    expect(batch!.message.spectrum).toBeDefined()

    const expected = Array.from(analyzer.results.get(spectrum).magnitude)
    const returned = mirror.apply(transferMessage(batch!.message, batch!.transfer))
    expect(returned).toHaveLength(analyzer.timeline.columns.length + 1)
    expect(Array.from(mirror.latestSpectrum!)).toEqual(expected)
    // The bin of the 1 kHz tone dominates.
    const bins = mirror.latestSpectrum!
    const peakBin = bins.indexOf(Math.max(...Array.from(bins)))
    expect(peakBin * (TEST_SAMPLE_RATE / 2048)).toBeCloseTo(1000, -2)
  })

  it('the mirror rejects a batch that does not continue the timeline', () => {
    const mirror = mirrorFor(['level'])
    const columns = Object.fromEntries(mirror.timeline.columns.map((c) => [c, new ArrayBuffer(16)]))
    expect(() => mirror.apply({ type: 'frames', startFrame: 5, count: 4, columns })).toThrow(
      /starts at 5/,
    )
  })

  it('the mirror notifies listeners with the appended range', () => {
    const analyzer = createAnalyzer({ sampleRate: TEST_SAMPLE_RATE }, [level])
    const batcher = new FrameBatcher(analyzer, { capacity: 4 })
    const mirror = mirrorFor(['level'])
    const seen: Array<[number, number]> = []
    mirror.onFrames((start, count) => seen.push([start, count]))

    analyzer.push(sine({ frequency: 440, seconds: 0.2 }).samples)
    for (let batch = batcher.take(); batch !== null; batch = batcher.take()) {
      mirror.apply(transferMessage(batch.message, batch.transfer))
    }
    expect(seen.length).toBeGreaterThan(1)
    expect(seen[0]).toEqual([0, 4])
    const total = seen.reduce((sum, [, count]) => sum + count, 0)
    expect(total).toBe(analyzer.timeline.length)
  })
})
