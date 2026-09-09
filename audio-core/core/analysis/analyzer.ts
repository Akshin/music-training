/**
 * Streaming analyser: PCM chunks in, timeline frames out.
 *
 * `push` frames the incoming samples (window `frameSize`, step `hopSize`), runs the resolved
 * extractor graph on each frame and appends the scalar results to the `Timeline`. It is
 * synchronous and platform-agnostic: the same instance runs inside a worker, on the main thread,
 * in Node, or over a file for an offline pass.
 *
 * The session clock is the count of samples delivered since the first chunk. Chunks are expected
 * to be contiguous; a gap (dropout) is zero-filled so time never drifts, an overlap is dropped.
 */

import type { AudioChunk } from '../model/audio'
import { Timeline } from '../model/timeline'
import type {
  AnalysisContext,
  AnyExtractor,
  ColumnWriter,
  Extractor,
  ExtractorInstance,
  FrameInput,
  ResultReader,
} from './extractor'
import { FrameBuffer } from './frame-buffer'
import { collectColumns, resolveExtractors } from './graph'

export interface AnalyzerConfig {
  readonly sampleRate: number
  /** Analysis window in samples; power of two. Default 2048 (43 ms at 48 kHz). */
  readonly frameSize?: number
  /** Step between frames in samples. Default `round(sampleRate / 100)` → 100 frames/s. */
  readonly hopSize?: number
  /** Frames per timeline storage block. Default 4096. */
  readonly blockFrames?: number
}

/** Per-extractor options keyed by extractor id. */
export type ExtractorOptions = Readonly<Record<string, object>>

export interface AnalyzerStats {
  /** Samples accepted so far (including zero-filled gaps). */
  samples: number
  /** Samples synthesised to fill gaps in the sample clock. */
  gapSamples: number
  /** Samples dropped because a chunk overlapped already-received data. */
  overlapSamples: number
  frames: number
}

export type FrameListener = (frame: FrameInput, results: ResultReader) => void

export const DEFAULT_FRAME_SIZE = 2048
const ZERO_BLOCK = new Float32Array(4096)

/** Hop that yields exactly 100 frames/s: 480 at 48 kHz, 441 at 44.1 kHz. */
export function defaultHopSize(sampleRate: number): number {
  return Math.round(sampleRate / 100)
}

/** Fills in the defaults of an `AnalyzerConfig`. Hosts use it to mirror the timeline geometry. */
export function resolveAnalysisContext(config: AnalyzerConfig): AnalysisContext {
  return {
    sampleRate: config.sampleRate,
    frameSize: config.frameSize ?? DEFAULT_FRAME_SIZE,
    hopSize: config.hopSize ?? defaultHopSize(config.sampleRate),
  }
}

class ResultStore implements ResultReader {
  private readonly values = new Map<string, unknown>()

  get<TResult>(extractor: Extractor<TResult, object>): TResult {
    if (!this.values.has(extractor.id)) {
      throw new Error(`Result of "${extractor.id}" is not available for this frame`)
    }
    return this.values.get(extractor.id) as TResult
  }

  has(extractor: Extractor<unknown, object>): boolean {
    return this.values.has(extractor.id)
  }

  set(id: string, value: unknown): void {
    this.values.set(id, value)
  }

  clear(): void {
    this.values.clear()
  }
}

class TimelineColumnWriter implements ColumnWriter {
  index = 0
  private readonly owner: string
  private readonly columns = new Map<string, { set(index: number, value: number): void }>()

  constructor(timeline: Timeline, owner: string, names: readonly string[]) {
    this.owner = owner
    for (const name of names) this.columns.set(name, timeline.column(name))
  }

  set(column: string, value: number): void {
    const target = this.columns.get(column)
    if (target === undefined) {
      throw new Error(`Extractor "${this.owner}" did not declare column "${column}"`)
    }
    target.set(this.index, value)
  }
}

interface Stage {
  readonly extractor: AnyExtractor
  readonly instance: ExtractorInstance<unknown>
  readonly writer: TimelineColumnWriter
}

export class Analyzer {
  readonly context: AnalysisContext
  readonly timeline: Timeline
  /** Extractors in execution order (dependencies first). */
  readonly extractors: readonly AnyExtractor[]
  /** Intermediate results of the most recent frame. */
  readonly results: ResultReader

  private readonly store = new ResultStore()
  private readonly stages: Stage[]
  private readonly frames: FrameBuffer
  private readonly frame: Float32Array
  private readonly current: { samples: Float32Array; index: number; time: number }
  private readonly listeners = new Set<FrameListener>()
  private readonly stats: AnalyzerStats = {
    samples: 0,
    gapSamples: 0,
    overlapSamples: 0,
    frames: 0,
  }

  constructor(
    config: AnalyzerConfig,
    features: readonly AnyExtractor[],
    options: ExtractorOptions = {},
  ) {
    this.context = resolveAnalysisContext(config)
    const { frameSize, hopSize } = this.context
    this.extractors = resolveExtractors(features)
    this.timeline = new Timeline({
      sampleRate: config.sampleRate,
      hopSize,
      originSample: frameSize / 2,
      columns: collectColumns(this.extractors),
      ...(config.blockFrames === undefined ? {} : { blockFrames: config.blockFrames }),
    })
    this.results = this.store
    this.frames = new FrameBuffer(frameSize, hopSize)
    this.frame = new Float32Array(frameSize)
    this.current = { samples: this.frame, index: 0, time: 0 }
    this.stages = this.extractors.map((extractor) => ({
      extractor,
      instance: extractor.create(this.context, options[extractor.id]),
      writer: new TimelineColumnWriter(this.timeline, extractor.id, extractor.columns),
    }))
  }

  /**
   * Feeds samples; returns the number of frames produced.
   * A bare `Float32Array` is taken as the next contiguous block; an `AudioChunk` is placed by its
   * `startSample` (gaps are zero-filled, overlaps dropped).
   */
  push(input: AudioChunk | Float32Array): number {
    if (input instanceof Float32Array) return this.accept(input, this.stats.samples)
    if (input.sampleRate !== this.context.sampleRate) {
      throw new Error(
        `Chunk sample rate ${input.sampleRate} does not match analyser rate ${this.context.sampleRate}`,
      )
    }
    return this.accept(input.samples, input.startSample)
  }

  /** Called after every frame with the frame input and that frame's intermediate results. */
  onFrame(listener: FrameListener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  getStats(): Readonly<AnalyzerStats> {
    return { ...this.stats }
  }

  /** Drops buffered samples and extractor state. The timeline is not cleared. */
  reset(): void {
    this.frames.reset()
    this.store.clear()
    for (const stage of this.stages) stage.instance.reset?.()
  }

  private accept(samples: Float32Array, startSample: number): number {
    const expected = this.stats.samples
    let start = 0
    if (startSample > expected) {
      this.fillGap(startSample - expected)
    } else if (startSample < expected) {
      start = Math.min(samples.length, expected - startSample)
      this.stats.overlapSamples += start
    }
    if (start < samples.length) {
      this.frames.write(samples, start)
      this.stats.samples += samples.length - start
    }
    return this.drain()
  }

  private fillGap(length: number): void {
    let remaining = length
    while (remaining > 0) {
      const count = Math.min(remaining, ZERO_BLOCK.length)
      this.frames.write(ZERO_BLOCK, 0, count)
      remaining -= count
    }
    this.stats.gapSamples += length
    this.stats.samples += length
  }

  private drain(): number {
    let produced = 0
    while (this.frames.read(this.frame)) {
      this.processFrame()
      produced++
    }
    return produced
  }

  private processFrame(): void {
    const index = this.timeline.append()
    const { current, store } = this
    current.index = index
    current.time = this.timeline.frameTime(index)
    for (const stage of this.stages) {
      stage.writer.index = index
      store.set(stage.extractor.id, stage.instance.process(current, store, stage.writer))
    }
    this.stats.frames++
    for (const listener of this.listeners) listener(current, store)
  }
}

export function createAnalyzer(
  config: AnalyzerConfig,
  features: readonly AnyExtractor[],
  options?: ExtractorOptions,
): Analyzer {
  return new Analyzer(config, features, options)
}
