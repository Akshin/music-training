/**
 * Columnar, append-only storage of per-frame scalar features.
 *
 * One `Column` per feature (f0, rms, cents, ...) instead of one object per frame: a 40-minute
 * session at 100 frames/s is 240 000 frames, and columns keep that at ~1 MB per feature with no
 * per-frame garbage. Storage grows in fixed blocks (default 4096 frames) so appending never copies
 * existing data. Unwritten cells read as NaN, which is also the value for "not applicable"
 * (e.g. f0 on an unvoiced frame).
 *
 * Frame `i` refers to the sample position `originSample + i * hopSize` on the session clock —
 * normally the centre of the analysis window, so features line up with what was actually heard.
 */

export interface TimelineSpec {
  readonly sampleRate: number
  /** Distance between consecutive frames, in samples. */
  readonly hopSize: number
  /** Sample position that frame 0 refers to (usually half the analysis window). */
  readonly originSample: number
  /** Scalar features stored per frame. */
  readonly columns: readonly string[]
  /** Frames per storage block. Must be a power of two. Default 4096. */
  readonly blockFrames?: number
}

const DEFAULT_BLOCK_FRAMES = 4096

export class Column {
  readonly name: string
  private readonly shift: number
  private readonly mask: number
  private readonly blockFrames: number
  private readonly blocks: Float32Array[] = []

  constructor(name: string, blockFrames: number) {
    if (blockFrames < 1 || (blockFrames & (blockFrames - 1)) !== 0) {
      throw new RangeError(`blockFrames must be a power of two, got ${blockFrames}`)
    }
    this.name = name
    this.blockFrames = blockFrames
    this.shift = Math.log2(blockFrames)
    this.mask = blockFrames - 1
  }

  /** Value at `index`, or NaN when nothing has been stored there. */
  get(index: number): number {
    const block = this.blocks[index >> this.shift]
    return block === undefined ? NaN : block[index & this.mask]
  }

  set(index: number, value: number): void {
    this.ensure(index)[index & this.mask] = value
  }

  /** Allocates storage up to and including `index`. */
  reserve(index: number): void {
    this.ensure(index)
  }

  /** Copies `[start, end)` into `out` (which must hold at least `end - start` values). */
  copyTo(out: Float32Array, start: number, end: number): void {
    let offset = 0
    let index = start
    while (index < end) {
      const block = this.blocks[index >> this.shift]
      const inBlock = index & this.mask
      const count = Math.min(end - index, this.blockFrames - inBlock)
      if (block === undefined) {
        out.fill(NaN, offset, offset + count)
      } else {
        out.set(block.subarray(inBlock, inBlock + count), offset)
      }
      offset += count
      index += count
    }
  }

  private ensure(index: number): Float32Array {
    const blockIndex = index >> this.shift
    while (this.blocks.length <= blockIndex) {
      this.blocks.push(new Float32Array(this.blockFrames).fill(NaN))
    }
    return this.blocks[blockIndex]
  }
}

export class Timeline {
  readonly sampleRate: number
  readonly hopSize: number
  readonly originSample: number
  readonly columns: readonly string[]
  private readonly byName = new Map<string, Column>()
  private frames = 0

  constructor(spec: TimelineSpec) {
    if (spec.hopSize < 1) throw new RangeError(`hopSize must be positive, got ${spec.hopSize}`)
    this.sampleRate = spec.sampleRate
    this.hopSize = spec.hopSize
    this.originSample = spec.originSample
    this.columns = [...spec.columns]
    const blockFrames = spec.blockFrames ?? DEFAULT_BLOCK_FRAMES
    for (const name of this.columns) {
      if (this.byName.has(name)) throw new Error(`Duplicate timeline column "${name}"`)
      this.byName.set(name, new Column(name, blockFrames))
    }
  }

  /** Number of frames appended so far. */
  get length(): number {
    return this.frames
  }

  /** Frames per second. */
  get frameRate(): number {
    return this.sampleRate / this.hopSize
  }

  /** Seconds between consecutive frames. */
  get frameDuration(): number {
    return this.hopSize / this.sampleRate
  }

  /** Time (seconds on the session clock) that frame `index` refers to. */
  frameTime(index: number): number {
    return (this.originSample + index * this.hopSize) / this.sampleRate
  }

  /** Index of the last frame at or before `seconds`. May be negative before the first frame. */
  frameAt(seconds: number): number {
    return Math.floor((seconds * this.sampleRate - this.originSample) / this.hopSize)
  }

  /** Frame range `[start, end)` covering `[fromSeconds, toSeconds)`, clamped to stored frames. */
  range(fromSeconds: number, toSeconds: number): { start: number; end: number } {
    const first = Math.ceil((fromSeconds * this.sampleRate - this.originSample) / this.hopSize)
    const start = Math.min(this.frames, Math.max(0, first))
    const end = Math.max(start, Math.min(this.frames, this.frameAt(toSeconds) + 1))
    return { start, end }
  }

  column(name: string): Column {
    const column = this.byName.get(name)
    if (column === undefined) throw new Error(`Unknown timeline column "${name}"`)
    return column
  }

  hasColumn(name: string): boolean {
    return this.byName.has(name)
  }

  /** Reserves the next frame in every column and returns its index. Cells start as NaN. */
  append(): number {
    const index = this.frames++
    for (const column of this.byName.values()) column.reserve(index)
    return index
  }

  /**
   * Appends `count` frames from column-wise data (e.g. a batch received from a worker).
   * Columns absent from `values` are left NaN.
   */
  appendBatch(count: number, values: Readonly<Record<string, ArrayLike<number>>>): number {
    const first = this.frames
    for (const [name, data] of Object.entries(values)) {
      const column = this.column(name)
      if (data.length < count) {
        throw new RangeError(`Column "${name}" has ${data.length} values, expected ${count}`)
      }
      for (let i = 0; i < count; i++) column.set(first + i, data[i])
    }
    for (const column of this.byName.values()) column.reserve(first + count - 1)
    this.frames = first + count
    return first
  }

  get(name: string, index: number): number {
    return this.column(name).get(index)
  }

  set(name: string, index: number, value: number): void {
    if (index < 0 || index >= this.frames) {
      throw new RangeError(`Frame ${index} is outside the timeline (length ${this.frames})`)
    }
    this.column(name).set(index, value)
  }

  /** Most recent value of a column, or NaN when the timeline is empty. */
  latest(name: string): number {
    return this.frames === 0 ? NaN : this.column(name).get(this.frames - 1)
  }

  /** Copy of `[start, end)` from a column; `end` is clamped to the stored length. */
  slice(name: string, start = 0, end = this.frames, out?: Float32Array): Float32Array {
    const clampedEnd = Math.min(end, this.frames)
    const count = Math.max(0, clampedEnd - start)
    const target = out ?? new Float32Array(count)
    this.column(name).copyTo(target, start, start + count)
    return target
  }
}
