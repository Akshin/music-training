/**
 * Receiving side of the frame transport: applies `frames` messages to a local `Timeline` and
 * keeps the latest spectrum, then hands the buffers back for recycling.
 *
 * The mirror is built from the same feature ids as the worker's analyser, so column layout, hop
 * and frame time agree by construction. Messages arrive in order over one channel; a batch that
 * does not start where the mirror ends is a programming error and is rejected.
 */

import type { Timeline } from '../model/timeline'
import type { FramesMessage } from './protocol'

export type FramesListener = (startFrame: number, count: number) => void

export class TimelineMirror {
  readonly timeline: Timeline
  private spectrum: Float32Array | undefined
  private readonly listeners = new Set<FramesListener>()

  constructor(timeline: Timeline) {
    this.timeline = timeline
  }

  /** Magnitude spectrum that arrived with the most recent batch, if the worker ships one. */
  get latestSpectrum(): Float32Array | undefined {
    return this.spectrum
  }

  /** Applies a batch and returns its buffers, which must be sent back for reuse. */
  apply(message: FramesMessage): ArrayBuffer[] {
    const { timeline } = this
    if (message.startFrame !== timeline.length) {
      throw new Error(
        `Frame batch starts at ${message.startFrame} but the mirror has ${timeline.length} frames`,
      )
    }
    const views: Record<string, Float32Array> = {}
    const buffers: ArrayBuffer[] = []
    for (const [name, buffer] of Object.entries(message.columns)) {
      views[name] = new Float32Array(buffer, 0, message.count)
      buffers.push(buffer)
    }
    timeline.appendBatch(message.count, views)

    if (message.spectrum !== undefined) {
      const incoming = new Float32Array(message.spectrum)
      if (this.spectrum === undefined || this.spectrum.length !== incoming.length) {
        this.spectrum = new Float32Array(incoming.length)
      }
      this.spectrum.set(incoming)
      buffers.push(message.spectrum)
    }

    for (const listener of this.listeners) listener(message.startFrame, message.count)
    return buffers
  }

  onFrames(listener: FramesListener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }
}
