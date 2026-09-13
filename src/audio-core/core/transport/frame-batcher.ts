/**
 * Packs newly analysed timeline frames into `frames` messages with pooled buffers.
 *
 * Lives on the analysing side (the worker). `take()` returns the next batch of frames that have
 * not been shipped yet, or null when the mirror is up to date. Buffers that the receiver sends
 * back through `recycle()` are reused, so a steady stream allocates nothing.
 */

import type { Analyzer } from '../analysis/analyzer'
import { BufferPool } from './buffer-pool'
import type { FramesMessage, TransportStats } from './protocol'

export interface FrameBatcherOptions {
  /** Frames per column buffer. Default 64. */
  readonly capacity?: number
  /** Provides the spectrum to attach to each batch (magnitude of the latest frame). */
  readonly spectrum?: () => Float32Array | undefined
}

export interface FrameBatch {
  readonly message: FramesMessage
  /** Buffers to pass as the transfer list. */
  readonly transfer: ArrayBuffer[]
}

const DEFAULT_CAPACITY = 64

export class FrameBatcher {
  readonly capacity: number
  private readonly analyzer: Analyzer
  private readonly columns: BufferPool
  private spectra: BufferPool | undefined
  private readonly spectrum: (() => Float32Array | undefined) | undefined
  private sent = 0

  constructor(analyzer: Analyzer, options: FrameBatcherOptions = {}) {
    this.analyzer = analyzer
    this.capacity = options.capacity ?? DEFAULT_CAPACITY
    this.columns = new BufferPool(this.capacity * Float32Array.BYTES_PER_ELEMENT)
    this.spectrum = options.spectrum
  }

  /** Frames shipped so far. */
  get shipped(): number {
    return this.sent
  }

  /** Frames analysed but not yet shipped. */
  get pending(): number {
    return this.analyzer.timeline.length - this.sent
  }

  take(): FrameBatch | null {
    const { timeline } = this.analyzer
    const count = Math.min(this.capacity, timeline.length - this.sent)
    if (count <= 0) return null

    const start = this.sent
    const transfer: ArrayBuffer[] = []
    const columns: Record<string, ArrayBuffer> = {}
    for (const name of timeline.columns) {
      const buffer = this.columns.acquire()
      timeline.slice(name, start, start + count, new Float32Array(buffer, 0, count))
      columns[name] = buffer
      transfer.push(buffer)
    }

    let spectrum: ArrayBuffer | undefined
    const magnitude = this.spectrum?.()
    if (magnitude !== undefined) {
      const bytes = magnitude.length * Float32Array.BYTES_PER_ELEMENT
      if (this.spectra === undefined || this.spectra.byteLength !== bytes) {
        this.spectra = new BufferPool(bytes)
      }
      spectrum = this.spectra.acquire()
      new Float32Array(spectrum).set(magnitude)
      transfer.push(spectrum)
    }

    this.sent += count
    const message: FramesMessage =
      spectrum === undefined
        ? { type: 'frames', startFrame: start, count, columns }
        : { type: 'frames', startFrame: start, count, columns, spectrum }
    return { message, transfer }
  }

  /** Accepts buffers returned by the receiver; sizes decide which pool they join. */
  recycle(buffers: Iterable<ArrayBuffer>): void {
    for (const buffer of buffers) {
      if (!this.columns.release(buffer)) this.spectra?.release(buffer)
    }
  }

  /** Forgets shipping progress (after the analyser was reset and the mirror cleared). */
  reset(): void {
    this.sent = 0
  }

  getStats(): TransportStats {
    const columns = this.columns.getStats()
    const pendingFrames = this.pending
    return this.spectra === undefined
      ? { columns, pendingFrames }
      : { columns, spectra: this.spectra.getStats(), pendingFrames }
  }
}
