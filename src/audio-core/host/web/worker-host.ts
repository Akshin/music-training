/**
 * Main-thread handle on the analysis worker.
 *
 * Builds the same timeline geometry as the worker (same feature ids → same columns, hop and frame
 * size), mirrors incoming frame batches into it and returns the buffers for reuse. UI code reads
 * `timeline` and `latestSpectrum`; nothing here touches audio APIs.
 */

import { resolveAnalysisContext, type AnalyzerStats } from '../../core/analysis/analyzer'
import type { AnalysisContext } from '../../core/analysis/extractor'
import { collectColumns, resolveExtractors } from '../../core/analysis/graph'
import { resolveFeatureIds } from '../../core/analysis/registry'
import type { AudioChunk } from '../../core/model/audio'
import { Timeline } from '../../core/model/timeline'
import type {
  HostToWorker,
  InitMessage,
  ReadyMessage,
  RecorderStats,
  TransportStats,
  WorkerToHost,
} from '../../core/transport/protocol'
import { TimelineMirror, type FramesListener } from '../../core/transport/timeline-mirror'

export interface WorkerHostOptions {
  readonly sampleRate: number
  /** Feature ids from the extractor registry, e.g. `['pitch', 'level', 'spectrum']`. */
  readonly features: readonly string[]
  readonly options?: Readonly<Record<string, object>>
  readonly frameSize?: number
  readonly hopSize?: number
  /** Receive the latest magnitude spectrum with each batch (needs the `spectrum` feature). */
  readonly spectrumSnapshot?: boolean
  readonly batchCapacity?: number
  /** Persist PCM on a tape in the worker. Default true. */
  readonly record?: boolean
  /** Overrides how the worker is created (tests, other bundlers). */
  readonly createWorker?: () => Worker
}

export interface WorkerHostStats {
  readonly analyzer: AnalyzerStats
  readonly transport: TransportStats
  readonly recorder?: RecorderStats
}

export type ErrorListener = (message: string) => void

function createDefaultWorker(): Worker {
  return new Worker(new URL('./analysis.worker.ts', import.meta.url), { type: 'module' })
}

export class WorkerHost {
  readonly context: AnalysisContext
  readonly timeline: Timeline
  /** Resolves once the worker has built its analyser; rejects if it failed to. */
  readonly ready: Promise<ReadyMessage>
  private readonly mirror: TimelineMirror
  private readonly worker: Worker
  private readonly errorListeners = new Set<ErrorListener>()
  private readonly statsWaiters: Array<(stats: WorkerHostStats) => void> = []
  private readonly wavWaiters = new Map<number, (buffer: ArrayBuffer) => void>()
  private readonly pcmWaiters = new Map<number, (samples: Float32Array) => void>()
  private nextRequestId = 1
  private resolveReady!: (message: ReadyMessage) => void
  private rejectReady!: (error: Error) => void
  private isReady = false
  private disposed = false

  constructor(options: WorkerHostOptions) {
    this.context = resolveAnalysisContext(options)
    const extractors = resolveExtractors(resolveFeatureIds(options.features))
    this.timeline = new Timeline({
      sampleRate: this.context.sampleRate,
      hopSize: this.context.hopSize,
      originSample: this.context.frameSize / 2,
      columns: collectColumns(extractors),
    })
    this.mirror = new TimelineMirror(this.timeline)
    this.ready = new Promise<ReadyMessage>((resolve, reject) => {
      this.resolveReady = resolve
      this.rejectReady = reject
    })

    this.worker = (options.createWorker ?? createDefaultWorker)()
    this.worker.onmessage = (event: MessageEvent<WorkerToHost>) => this.handle(event.data)
    this.worker.onerror = (event) => this.fail(event.message || 'Analysis worker crashed')

    const init: InitMessage = {
      type: 'init',
      sampleRate: options.sampleRate,
      features: options.features,
      ...(options.options === undefined ? {} : { options: options.options }),
      ...(options.frameSize === undefined ? {} : { frameSize: options.frameSize }),
      ...(options.hopSize === undefined ? {} : { hopSize: options.hopSize }),
      ...(options.spectrumSnapshot === undefined
        ? {}
        : { spectrumSnapshot: options.spectrumSnapshot }),
      ...(options.batchCapacity === undefined ? {} : { batchCapacity: options.batchCapacity }),
      ...(options.record === undefined ? {} : { record: options.record }),
    }
    this.send(init)
  }

  /** Magnitude spectrum of the newest analysed frame (when `spectrumSnapshot` is on). */
  get latestSpectrum(): Float32Array | undefined {
    return this.mirror.latestSpectrum
  }

  /**
   * Routes PCM from a capture source directly into the worker. Pass the port returned by
   * `MicSource.createPort()`; the port is transferred and must not be used afterwards.
   */
  attachCapture(port: MessagePort): void {
    this.send({ type: 'connect' }, [port])
  }

  /**
   * Feeds a chunk from the main thread (files, tests). The chunk's buffer is transferred to the
   * worker — copy first if you still need it.
   */
  push(chunk: AudioChunk): void {
    const { samples } = chunk
    const owns = samples.byteOffset === 0 && samples.byteLength === samples.buffer.byteLength
    const buffer = (owns ? samples.buffer : samples.slice().buffer) as ArrayBuffer
    this.send(
      {
        type: 'pcm',
        samples: buffer,
        startSample: chunk.startSample,
        sampleRate: chunk.sampleRate,
      },
      [buffer],
    )
  }

  /** Fires after each batch of frames lands in `timeline`. */
  onFrames(listener: FramesListener): () => void {
    return this.mirror.onFrames(listener)
  }

  onError(listener: ErrorListener): () => void {
    this.errorListeners.add(listener)
    return () => {
      this.errorListeners.delete(listener)
    }
  }

  getStats(): Promise<WorkerHostStats> {
    return new Promise((resolve) => {
      this.statsWaiters.push(resolve)
      this.send({ type: 'stats' })
    })
  }

  /** Encodes the taped PCM (or a range) as a 16-bit WAV. */
  exportWav(startSample?: number, count?: number): Promise<ArrayBuffer> {
    const requestId = this.nextRequestId++
    return new Promise((resolve) => {
      this.wavWaiters.set(requestId, resolve)
      this.send({
        type: 'export-wav',
        requestId,
        ...(startSample === undefined ? {} : { startSample }),
        ...(count === undefined ? {} : { count }),
      })
    })
  }

  /** Reads float32 samples back from the tape. */
  readPcm(startSample: number, count: number): Promise<Float32Array> {
    const requestId = this.nextRequestId++
    return new Promise((resolve) => {
      this.pcmWaiters.set(requestId, resolve)
      this.send({ type: 'read-pcm', requestId, startSample, count })
    })
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.worker.terminate()
    if (!this.isReady)
      this.rejectReady(new Error('WorkerHost disposed before the worker was ready'))
  }

  private send(message: HostToWorker, transfer: Transferable[] = []): void {
    if (this.disposed) return
    this.worker.postMessage(message, transfer)
  }

  private handle(message: WorkerToHost): void {
    switch (message.type) {
      case 'ready':
        this.isReady = true
        this.resolveReady(message)
        break
      case 'frames': {
        const buffers = this.mirror.apply(message)
        this.send({ type: 'recycle-frames', buffers }, buffers)
        break
      }
      case 'stats': {
        const waiter = this.statsWaiters.shift()
        waiter?.({
          analyzer: message.analyzer,
          transport: message.transport,
          ...(message.recorder === undefined ? {} : { recorder: message.recorder }),
        })
        break
      }
      case 'wav':
        this.wavWaiters.get(message.requestId)?.(message.buffer)
        this.wavWaiters.delete(message.requestId)
        break
      case 'pcm-slice':
        this.pcmWaiters.get(message.requestId)?.(new Float32Array(message.samples))
        this.pcmWaiters.delete(message.requestId)
        break
      case 'error':
        this.fail(message.message)
        break
    }
  }

  private fail(message: string): void {
    if (!this.isReady) this.rejectReady(new Error(message))
    for (const listener of this.errorListeners) listener(message)
  }
}
