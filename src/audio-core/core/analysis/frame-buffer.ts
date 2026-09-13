/**
 * Turns a stream of arbitrarily sized sample blocks into overlapping fixed-size frames.
 *
 * Samples are appended to a pending buffer; whenever `frameSize` samples are available a frame is
 * copied out and the buffer advances by `hopSize`. The pending buffer only reallocates if a block
 * larger than anything seen before arrives.
 */
export class FrameBuffer {
  readonly frameSize: number
  readonly hopSize: number
  private pending: Float32Array
  private count = 0

  constructor(frameSize: number, hopSize: number) {
    if (frameSize < 1) throw new RangeError(`frameSize must be positive, got ${frameSize}`)
    if (hopSize < 1 || hopSize > frameSize) {
      throw new RangeError(`hopSize must be in [1, frameSize], got ${hopSize}`)
    }
    this.frameSize = frameSize
    this.hopSize = hopSize
    this.pending = new Float32Array(frameSize * 2)
  }

  /** Samples waiting to be framed. */
  get available(): number {
    return this.count
  }

  write(samples: Float32Array, start = 0, end = samples.length): void {
    const length = end - start
    if (length <= 0) return
    const needed = this.count + length
    if (needed > this.pending.length) {
      const grown = new Float32Array(Math.max(needed, this.pending.length * 2))
      grown.set(this.pending.subarray(0, this.count))
      this.pending = grown
    }
    this.pending.set(
      start === 0 && end === samples.length ? samples : samples.subarray(start, end),
      this.count,
    )
    this.count = needed
  }

  /** Copies the next frame into `out` and advances by one hop. Returns false if not enough data. */
  read(out: Float32Array): boolean {
    if (this.count < this.frameSize) return false
    out.set(this.pending.subarray(0, this.frameSize))
    this.pending.copyWithin(0, this.hopSize, this.count)
    this.count -= this.hopSize
    return true
  }

  reset(): void {
    this.count = 0
  }
}
