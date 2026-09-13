/**
 * Generic PCM pump: a live capture, a decoded file, or a test generator, all as `AudioChunk`s
 * on one sample clock.
 *
 * Does not open devices. `MicSource` / `FileSource` produce samples; this object just numbers them.
 */

import { chunkSamples, type AudioChunk } from '../core/model/audio'

export interface StreamSourceOptions {
  readonly sampleRate: number
  /** Default 4096. */
  readonly chunkSize?: number
}

export type ChunkSink = (chunk: AudioChunk) => void

export class StreamSource {
  readonly sampleRate: number
  readonly chunkSize: number
  private startSample = 0

  constructor(options: StreamSourceOptions) {
    this.sampleRate = options.sampleRate
    this.chunkSize = options.chunkSize ?? 4096
  }

  /** Session-clock index of the next sample that will be delivered. */
  get samplesDelivered(): number {
    return this.startSample
  }

  /** One incoming block, already the right size (or not — the analyser accepts any length). */
  push(samples: Float32Array): AudioChunk {
    const chunk: AudioChunk = {
      samples,
      startSample: this.startSample,
      sampleRate: this.sampleRate,
    }
    this.startSample += samples.length
    return chunk
  }

  /** Split a complete buffer and hand each chunk to `sink`, advancing the clock. */
  pump(samples: Float32Array, sink: ChunkSink): void {
    for (const chunk of chunkSamples(samples, this.chunkSize, this.sampleRate, this.startSample)) {
      sink(chunk)
    }
    this.startSample += samples.length
  }

  reset(): void {
    this.startSample = 0
  }
}
