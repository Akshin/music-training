/**
 * Offline analysis over a stored tape.
 *
 * Same `Analyzer` as the live path, fed from int16 cold chunks plus the hot ring, so a 40-minute
 * take does not have to sit in one Float32Array. Extractors, hop and frame time match `/lab`.
 */

import {
  createAnalyzer,
  type Analyzer,
  type AnalyzerConfig,
  type ExtractorOptions,
} from '../analysis/analyzer'
import type { AnyExtractor } from '../analysis/extractor'
import { analyzeOffline } from '../analysis/offline'
import { decodeWav, encodeWav } from './wav'
import type { PcmTape } from './pcm-tape'

const BLOCK = 48000

/** Streams a tape into a fresh analyser in ~1 s blocks. */
export function analyzeTape(
  tape: PcmTape,
  features: readonly AnyExtractor[],
  options: ExtractorOptions = {},
  config: Omit<AnalyzerConfig, 'sampleRate'> = {},
): Analyzer {
  const analyzer = createAnalyzer({ sampleRate: tape.sampleRate, ...config }, features, options)
  const block = Math.min(BLOCK, Math.max(1, tape.chunkSamples))
  const buffer = new Float32Array(block)
  for (let start = 0; start < tape.length; start += block) {
    const count = Math.min(block, tape.length - start)
    tape.read(start, count, buffer)
    analyzer.push(count === block ? buffer : buffer.subarray(0, count))
  }
  return analyzer
}

/** Decodes a 16-bit PCM WAV and runs the same analyser the live path uses. */
export function analyzeWav(
  buffer: ArrayBuffer,
  features: readonly AnyExtractor[],
  options: ExtractorOptions = {},
  config: Omit<AnalyzerConfig, 'sampleRate'> = {},
): Analyzer {
  const wav = decodeWav(buffer)
  return analyzeOffline(wav.samples, { sampleRate: wav.sampleRate, ...config }, features, options)
}

export function tapeToWav(
  tape: PcmTape,
  startSample = 0,
  count = tape.length - startSample,
): ArrayBuffer {
  return encodeWav(tape.read(startSample, Math.max(0, count)), tape.sampleRate)
}
