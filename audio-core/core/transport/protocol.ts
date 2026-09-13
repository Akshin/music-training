/**
 * Messages exchanged between a host (main thread), the analysis worker and the capture worklet.
 *
 * Plain data only: everything heavy travels as `ArrayBuffer` in the transfer list, so a message
 * moves ownership instead of copying. Buffers come back through `recycle` messages and are reused;
 * in steady state neither side allocates. This file must stay free of platform types — it is
 * compiled into the worklet, the worker and the main thread alike.
 */

import type { AnalyzerStats } from '../analysis/analyzer'

/** Name the capture processor registers under in the AudioWorklet global scope. */
export const CAPTURE_PROCESSOR_NAME = 'audio-core-capture'

/** A block of Float32 PCM from a capture source. Sent worklet → worker, or host → worker. */
export interface PcmMessage {
  readonly type: 'pcm'
  /** Float32 samples; ownership transfers with the message. */
  readonly samples: ArrayBuffer
  readonly startSample: number
  readonly sampleRate: number
}

/** Returns PCM buffers to the capture source for reuse. Sent worker → worklet. */
export interface RecyclePcmMessage {
  readonly type: 'recycle-pcm'
  readonly buffers: readonly ArrayBuffer[]
}

/**
 * Carries a `MessagePort` in the transfer list. Host → worklet: post PCM to this port instead of
 * the node. Host → worker: read PCM from this port. Both ends of one `MessageChannel`, so PCM flows
 * audio thread → worker without touching the main thread.
 */
export interface ConnectMessage {
  readonly type: 'connect'
}

export interface StopMessage {
  readonly type: 'stop'
}

export type CaptureIncoming = ConnectMessage | RecyclePcmMessage | StopMessage
export type CaptureOutgoing = PcmMessage

export interface InitMessage {
  readonly type: 'init'
  readonly sampleRate: number
  readonly frameSize?: number
  readonly hopSize?: number
  /** Feature ids resolved through the extractor registry. */
  readonly features: readonly string[]
  readonly options?: Readonly<Record<string, object>>
  /** Ship the latest magnitude spectrum with each frame batch (requires the `spectrum` feature). */
  readonly spectrumSnapshot?: boolean
  /** Frames per batch buffer. Default 64. */
  readonly batchCapacity?: number
  /** Persist incoming PCM on a tape (hot ring + cold int16). Default true. */
  readonly record?: boolean
}

/** Returns frame-batch buffers to the worker's pool. */
export interface RecycleFramesMessage {
  readonly type: 'recycle-frames'
  readonly buffers: readonly ArrayBuffer[]
}

export interface StatsRequestMessage {
  readonly type: 'stats'
}

export interface ExportWavMessage {
  readonly type: 'export-wav'
  readonly requestId: number
  readonly startSample?: number
  readonly count?: number
}

export interface ReadPcmMessage {
  readonly type: 'read-pcm'
  readonly requestId: number
  readonly startSample: number
  readonly count: number
}

export type HostToWorker =
  | InitMessage
  | ConnectMessage
  | PcmMessage
  | RecycleFramesMessage
  | StatsRequestMessage
  | ExportWavMessage
  | ReadPcmMessage

export interface ReadyMessage {
  readonly type: 'ready'
  readonly columns: readonly string[]
  readonly sampleRate: number
  readonly frameSize: number
  readonly hopSize: number
}

/** New timeline frames `[startFrame, startFrame + count)`, one Float32 buffer per column. */
export interface FramesMessage {
  readonly type: 'frames'
  readonly startFrame: number
  readonly count: number
  /** Column name → Float32 buffer holding at least `count` values. */
  readonly columns: Readonly<Record<string, ArrayBuffer>>
  /** Magnitude spectrum of the last frame in the batch, when requested. */
  readonly spectrum?: ArrayBuffer
}

export interface PoolStats {
  readonly allocated: number
  readonly free: number
}

export interface TransportStats {
  /** Frame-batch column buffers. */
  readonly columns: PoolStats
  /** Spectrum snapshot buffers, when snapshots are enabled. */
  readonly spectra?: PoolStats
  /** Timeline frames analysed but not yet shipped to the host. */
  readonly pendingFrames: number
}

export interface RecorderStats {
  readonly samples: number
  readonly seconds: number
  readonly hotSamples: number
  readonly coldChunks: number
  readonly gapSamples: number
  readonly overlapSamples: number
  readonly backend: 'memory' | 'opfs'
}

export interface StatsMessage {
  readonly type: 'stats'
  readonly analyzer: AnalyzerStats
  readonly transport: TransportStats
  readonly recorder?: RecorderStats
}

export interface WavMessage {
  readonly type: 'wav'
  readonly requestId: number
  readonly buffer: ArrayBuffer
}

export interface PcmSliceMessage {
  readonly type: 'pcm-slice'
  readonly requestId: number
  readonly startSample: number
  readonly count: number
  readonly samples: ArrayBuffer
}

export interface ErrorMessage {
  readonly type: 'error'
  readonly message: string
}

export type WorkerToHost =
  ReadyMessage | FramesMessage | StatsMessage | WavMessage | PcmSliceMessage | ErrorMessage
