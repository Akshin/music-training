/**
 * Radix-2 complex FFT with precomputed twiddles and bit-reversal table.
 *
 * Work buffers are Float64Array: JS arithmetic is double anyway, and 64-bit storage keeps the
 * cancellation-prone steps (YIN's difference function, LPC) exact enough without any cost.
 * All methods are allocation-free after construction.
 */
export class Fft {
  readonly size: number
  private readonly reverse: Uint32Array
  private readonly cos: Float64Array
  private readonly sin: Float64Array

  constructor(size: number) {
    if (size < 2 || (size & (size - 1)) !== 0) {
      throw new RangeError(`FFT size must be a power of two ≥ 2, got ${size}`)
    }
    this.size = size
    const bits = Math.log2(size)
    this.reverse = new Uint32Array(size)
    for (let i = 0; i < size; i++) {
      let reversed = 0
      for (let bit = 0; bit < bits; bit++) reversed |= ((i >> bit) & 1) << (bits - 1 - bit)
      this.reverse[i] = reversed
    }
    const half = size >> 1
    this.cos = new Float64Array(half)
    this.sin = new Float64Array(half)
    for (let k = 0; k < half; k++) {
      const angle = (2 * Math.PI * k) / size
      this.cos[k] = Math.cos(angle)
      this.sin[k] = Math.sin(angle)
    }
  }

  /** In-place forward transform: X[k] = Σ x[n]·e^(−2πi·kn/N). */
  forward(re: Float64Array, im: Float64Array): void {
    this.transform(re, im, -1)
  }

  /** In-place inverse transform including the 1/N scale, so `inverse(forward(x)) = x`. */
  inverse(re: Float64Array, im: Float64Array): void {
    this.transform(re, im, 1)
    const scale = 1 / this.size
    for (let i = 0; i < this.size; i++) {
      re[i] *= scale
      im[i] *= scale
    }
  }

  private transform(re: Float64Array, im: Float64Array, sign: 1 | -1): void {
    const n = this.size
    if (re.length < n || im.length < n) {
      throw new RangeError(`Buffers must hold ${n} values`)
    }
    const { reverse, cos, sin } = this

    for (let i = 0; i < n; i++) {
      const j = reverse[i]
      if (j > i) {
        const tr = re[i]
        re[i] = re[j]
        re[j] = tr
        const ti = im[i]
        im[i] = im[j]
        im[j] = ti
      }
    }

    for (let len = 2; len <= n; len <<= 1) {
      const half = len >> 1
      const step = n / len
      for (let start = 0; start < n; start += len) {
        for (let j = 0, k = 0; j < half; j++, k += step) {
          const wr = cos[k]
          const wi = sign * sin[k]
          const a = start + j
          const b = a + half
          const xr = re[b] * wr - im[b] * wi
          const xi = re[b] * wi + im[b] * wr
          re[b] = re[a] - xr
          im[b] = im[a] - xi
          re[a] += xr
          im[a] += xi
        }
      }
    }
  }
}

/**
 * Forward FFT of a real signal with reusable buffers and the usual read-outs.
 * Bins `0..size/2` are meaningful (the rest mirror them).
 */
export class RealFft {
  readonly size: number
  /** Number of unique bins: size / 2 + 1. */
  readonly bins: number
  readonly re: Float64Array
  readonly im: Float64Array
  private readonly fft: Fft

  constructor(size: number) {
    this.fft = new Fft(size)
    this.size = size
    this.bins = (size >> 1) + 1
    this.re = new Float64Array(size)
    this.im = new Float64Array(size)
  }

  /** Transforms `input` (zero-padded or truncated to `size`); results are in `re`/`im`. */
  forward(input: ArrayLike<number>): void {
    const n = Math.min(input.length, this.size)
    for (let i = 0; i < n; i++) this.re[i] = input[i]
    this.re.fill(0, n)
    this.im.fill(0)
    this.fft.forward(this.re, this.im)
  }

  /** Writes `scale · |X[k]|` for the unique bins into `out`. */
  magnitude(out: Float32Array | Float64Array, scale = 1): void {
    const { re, im, bins } = this
    for (let k = 0; k < bins; k++) out[k] = scale * Math.hypot(re[k], im[k])
  }

  /** Writes `scale · |X[k]|²` for the unique bins into `out`. */
  power(out: Float32Array | Float64Array, scale = 1): void {
    const { re, im, bins } = this
    for (let k = 0; k < bins; k++) out[k] = scale * (re[k] * re[k] + im[k] * im[k])
  }

  /** Centre frequency of bin `k` for the given sample rate. */
  binFrequency(k: number, sampleRate: number): number {
    return (k * sampleRate) / this.size
  }
}
