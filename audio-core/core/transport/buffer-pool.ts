/**
 * Free list of equally sized `ArrayBuffer`s.
 *
 * Transferring a buffer with `postMessage` detaches it on the sending side, so a sender that ships
 * one buffer per batch would allocate on every message. Receivers return buffers through a recycle
 * message and the pool hands them out again; only when the receiver falls behind does the pool
 * grow. Detached or foreign-sized buffers are rejected on release.
 */
export class BufferPool {
  readonly byteLength: number
  private readonly free: ArrayBuffer[] = []
  private allocated = 0

  constructor(byteLength: number) {
    if (byteLength <= 0) throw new RangeError(`byteLength must be positive, got ${byteLength}`)
    this.byteLength = byteLength
  }

  acquire(): ArrayBuffer {
    const buffer = this.free.pop()
    if (buffer !== undefined) return buffer
    this.allocated++
    return new ArrayBuffer(this.byteLength)
  }

  /** Returns a buffer to the pool. Ignores buffers that do not belong here. */
  release(buffer: ArrayBuffer): boolean {
    if (buffer.byteLength !== this.byteLength || buffer.detached) return false
    this.free.push(buffer)
    return true
  }

  releaseAll(buffers: Iterable<ArrayBuffer>): number {
    let accepted = 0
    for (const buffer of buffers) if (this.release(buffer)) accepted++
    return accepted
  }

  getStats(): { allocated: number; free: number } {
    return { allocated: this.allocated, free: this.free.length }
  }
}
