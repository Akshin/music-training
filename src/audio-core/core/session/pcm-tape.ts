/**
 * Session PCM: a float32 hot ring of the recent past, older audio as int16 chunks in a cold store.
 *
 * The analyser never keeps the waveform; this does. Capture writes here before recycling the
 * worklet buffer. Reads go to the ring when the range is still hot, otherwise they decode cold
 * chunks. A 40-minute take is ~23 MB of hot float32 plus ~230 MB of int16 on disk, not 461 MB of
 * live float32.
 *
 * The sample clock matches the analyser: gaps are zero-filled, overlaps dropped.
 */

import { floatToInt16, INT16_MAX } from './pcm'

export const DEFAULT_HOT_SECONDS = 120
export const DEFAULT_CHUNK_SECONDS = 10

export type PcmBackend = 'memory' | 'opfs'

/** Append-only int16 chunks. Implementations must copy on `write` if they keep the view. */
export interface PcmColdStore {
  readonly chunkSamples: number
  readonly backend: PcmBackend
  write(index: number, pcm: Int16Array): void
  read(index: number): Int16Array | undefined
  get chunkCount(): number
  clear(): void
}

export class MemoryColdStore implements PcmColdStore {
  readonly chunkSamples: number
  readonly backend: PcmBackend = 'memory'
  private readonly chunks: Int16Array[] = []

  constructor(chunkSamples: number) {
    if (chunkSamples < 1) throw new RangeError(`chunkSamples must be positive, got ${chunkSamples}`)
    this.chunkSamples = chunkSamples
  }

  write(index: number, pcm: Int16Array): void {
    if (pcm.length !== this.chunkSamples) {
      throw new RangeError(`Chunk has ${pcm.length} samples, expected ${this.chunkSamples}`)
    }
    this.chunks[index] = pcm.slice()
  }

  read(index: number): Int16Array | undefined {
    return this.chunks[index]
  }

  get chunkCount(): number {
    return this.chunks.length
  }

  clear(): void {
    this.chunks.length = 0
  }
}

export interface PcmTapeOptions {
  readonly sampleRate: number
  /** Seconds kept as float32. Default 120. Must be ≥ `chunkSeconds`. */
  readonly hotSeconds?: number
  /** Int16 chunk length in seconds. Default 10. */
  readonly chunkSeconds?: number
  readonly cold?: PcmColdStore
}

export interface PcmTapeStats {
  readonly samples: number
  readonly seconds: number
  readonly hotSamples: number
  readonly coldChunks: number
  readonly gapSamples: number
  readonly overlapSamples: number
  readonly backend: PcmBackend
}

const ZERO = new Float32Array(4096)

export class PcmTape {
  readonly sampleRate: number
  readonly hotCapacity: number
  readonly chunkSamples: number
  private cold: PcmColdStore
  private readonly ring: Float32Array
  private readonly chunkFloat: Float32Array
  private readonly chunkInt: Int16Array
  private samples = 0
  private flushed = 0
  private gapSamples = 0
  private overlapSamples = 0

  constructor(options: PcmTapeOptions) {
    const hotSeconds = options.hotSeconds ?? DEFAULT_HOT_SECONDS
    const chunkSeconds = options.chunkSeconds ?? DEFAULT_CHUNK_SECONDS
    if (hotSeconds < chunkSeconds) {
      throw new RangeError(`hotSeconds (${hotSeconds}) must be ≥ chunkSeconds (${chunkSeconds})`)
    }
    this.sampleRate = options.sampleRate
    this.hotCapacity = Math.round(hotSeconds * options.sampleRate)
    this.chunkSamples = Math.round(chunkSeconds * options.sampleRate)
    this.cold = options.cold ?? new MemoryColdStore(this.chunkSamples)
    if (this.cold.chunkSamples !== this.chunkSamples) {
      throw new Error('Cold store chunk size does not match the tape')
    }
    this.ring = new Float32Array(this.hotCapacity)
    this.chunkFloat = new Float32Array(this.chunkSamples)
    this.chunkInt = new Int16Array(this.chunkSamples)
  }

  get length(): number {
    return this.samples
  }

  /**
   * Appends samples. A bare `Float32Array` is the next contiguous block; with `startSample`, gaps
   * are zero-filled and overlaps dropped, matching `Analyzer.push`.
   */
  append(samples: Float32Array, startSample = this.samples): void {
    let start = 0
    if (startSample > this.samples) {
      this.fillGap(startSample - this.samples)
    } else if (startSample < this.samples) {
      start = Math.min(samples.length, this.samples - startSample)
      this.overlapSamples += start
    }
    if (start < samples.length) this.write(samples, start, samples.length)
  }

  /**
   * Copies `[startSample, startSample + count)` into `out` (or a new buffer).
   * Missing cold data and reads past the end are silence.
   */
  read(startSample: number, count: number, out?: Float32Array): Float32Array {
    if (startSample < 0) throw new RangeError(`startSample must be ≥ 0, got ${startSample}`)
    const target = out ?? new Float32Array(count)
    if (target.length < count) throw new RangeError('Output buffer is shorter than `count`')
    const end = Math.min(startSample + count, this.samples)
    const available = Math.max(0, end - startSample)
    if (available < count) target.fill(0, available, count)
    if (available <= 0) return target

    const hotStart = Math.max(0, this.samples - this.hotCapacity)
    let cursor = startSample
    let offset = 0
    if (cursor < hotStart) {
      const coldEnd = Math.min(hotStart, end)
      this.readCold(cursor, coldEnd, target, offset)
      offset += coldEnd - cursor
      cursor = coldEnd
    }
    if (cursor < end) this.readHot(cursor, end, target, offset)
    return target
  }

  /** Swaps the cold backend, copying already-flushed chunks across. */
  useCold(store: PcmColdStore): void {
    if (store.chunkSamples !== this.chunkSamples) {
      throw new Error('Cold store chunk size does not match the tape')
    }
    for (let i = 0; i < this.flushed; i++) {
      const chunk = this.cold.read(i)
      if (chunk !== undefined) store.write(i, chunk)
    }
    this.cold = store
  }

  getStats(): PcmTapeStats {
    return {
      samples: this.samples,
      seconds: this.samples / this.sampleRate,
      hotSamples: Math.min(this.samples, this.hotCapacity),
      coldChunks: this.flushed,
      gapSamples: this.gapSamples,
      overlapSamples: this.overlapSamples,
      backend: this.cold.backend,
    }
  }

  clear(): void {
    this.samples = 0
    this.flushed = 0
    this.gapSamples = 0
    this.overlapSamples = 0
    this.ring.fill(0)
    this.cold.clear()
  }

  private fillGap(length: number): void {
    let remaining = length
    while (remaining > 0) {
      const count = Math.min(remaining, ZERO.length)
      this.write(ZERO, 0, count)
      remaining -= count
    }
    this.gapSamples += length
  }

  private write(samples: ArrayLike<number>, start: number, end: number): void {
    const { ring, hotCapacity } = this
    for (let i = start; i < end; i++) {
      ring[this.samples % hotCapacity] = samples[i]
      this.samples++
      if (this.samples - this.flushed * this.chunkSamples >= this.chunkSamples) this.flushNext()
    }
  }

  private flushNext(): void {
    const start = this.flushed * this.chunkSamples
    this.readHot(start, start + this.chunkSamples, this.chunkFloat, 0)
    floatToInt16(this.chunkFloat, this.chunkInt)
    this.cold.write(this.flushed, this.chunkInt)
    this.flushed++
  }

  private readHot(start: number, end: number, out: Float32Array, offset: number): void {
    const { ring, hotCapacity } = this
    for (let i = start, o = offset; i < end; i++, o++) out[o] = ring[i % hotCapacity]
  }

  private readCold(start: number, end: number, out: Float32Array, offset: number): void {
    const { chunkSamples } = this
    let cursor = start
    let o = offset
    while (cursor < end) {
      const index = Math.floor(cursor / chunkSamples)
      const inChunk = cursor - index * chunkSamples
      const take = Math.min(chunkSamples - inChunk, end - cursor)
      const chunk = this.cold.read(index)
      if (chunk === undefined) {
        out.fill(0, o, o + take)
      } else {
        for (let i = 0; i < take; i++) out[o + i] = chunk[inChunk + i] / INT16_MAX
      }
      cursor += take
      o += take
    }
  }
}
