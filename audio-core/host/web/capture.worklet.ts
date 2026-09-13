/**
 * AudioWorklet processor that captures raw PCM and ships it in batches.
 *
 * Runs on the audio rendering thread, so it does as little as possible: copy each 128-sample render
 * quantum into the current batch, stamp the batch with its position on the audio clock
 * (`currentFrame`) and post it. No DSP happens here — analysis lives in the worker.
 *
 * Batches are posted to the node's port by default; after a `connect` message they go straight to
 * the transferred `MessagePort` (the worker's end of a `MessageChannel`). Consumers send used
 * buffers back with `recycle-pcm`, so the free list makes the steady state allocation-free.
 */

import {
  CAPTURE_PROCESSOR_NAME,
  type CaptureIncoming,
  type PcmMessage,
} from '../../core/transport/protocol'

export interface CaptureProcessorOptions {
  /** Samples per PCM message; rounded to whole render quanta (128). Default 512. */
  readonly batchSize?: number
}

/** The subset of `AudioWorkletNodeOptions` the processor reads (DOM types are not available here). */
interface ProcessorConstructorOptions {
  readonly processorOptions?: CaptureProcessorOptions
}

const QUANTUM = 128
const DEFAULT_BATCH = 512

class CaptureProcessor extends AudioWorkletProcessor {
  private readonly batchSize: number
  private target: MessagePort
  private batch: Float32Array
  private filled = 0
  /** Audio-clock frame of the first quantum ever processed; batch positions are relative to it. */
  private origin = -1
  /** Audio-clock frame of the first sample in the batch under construction. */
  private batchFrame = 0
  private readonly free: ArrayBuffer[] = []
  private running = true

  constructor(options?: ProcessorConstructorOptions) {
    super()
    const requested = options?.processorOptions?.batchSize ?? DEFAULT_BATCH
    this.batchSize = Math.max(QUANTUM, Math.round(requested / QUANTUM) * QUANTUM)
    this.batch = new Float32Array(this.batchSize)
    this.target = this.port
    this.port.onmessage = (event: MessageEvent<CaptureIncoming>) => this.handle(event)
  }

  process(inputs: Float32Array[][]): boolean {
    if (!this.running) return false
    if (this.origin < 0) this.origin = currentFrame
    if (this.filled === 0) this.batchFrame = currentFrame

    // An input without channels means the upstream node is currently silent; keep the clock going.
    const channel = inputs[0]?.[0]
    if (channel === undefined) {
      this.batch.fill(0, this.filled, this.filled + QUANTUM)
    } else {
      this.batch.set(channel, this.filled)
    }
    this.filled += QUANTUM
    if (this.filled >= this.batchSize) this.flush()
    return true
  }

  private handle(event: MessageEvent<CaptureIncoming>): void {
    const message = event.data
    switch (message.type) {
      case 'connect': {
        const port = event.ports[0]
        if (port === undefined) return
        this.target = port
        port.onmessage = (incoming: MessageEvent<CaptureIncoming>) => this.handle(incoming)
        break
      }
      case 'recycle-pcm':
        for (const buffer of message.buffers) {
          if (buffer.byteLength === this.batch.byteLength && !buffer.detached)
            this.free.push(buffer)
        }
        break
      case 'stop':
        if (this.filled > 0) this.flush()
        this.running = false
        break
    }
  }

  private flush(): void {
    const count = this.filled
    let samples: ArrayBuffer
    if (count === this.batchSize) {
      samples = this.batch.buffer as ArrayBuffer
      this.batch = new Float32Array(this.free.pop() ?? new ArrayBuffer(this.batchSize * 4))
    } else {
      // Partial batch on stop: copy so the receiver sees exactly `count` samples.
      samples = this.batch.slice(0, count).buffer as ArrayBuffer
    }
    this.filled = 0
    const message: PcmMessage = {
      type: 'pcm',
      samples,
      startSample: this.batchFrame - this.origin,
      sampleRate,
    }
    this.target.postMessage(message, [samples])
  }
}

registerProcessor(CAPTURE_PROCESSOR_NAME, CaptureProcessor)
