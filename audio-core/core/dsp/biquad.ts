/**
 * Second-order IIR (biquad) in transposed direct form II.
 *
 * Transfer function `(b0 + b1 z^{-1} + b2 z^{-2}) / (1 + a1 z^{-1} + a2 z^{-2})`.
 * Coefficients are normalised so a0 = 1. State lives on the instance; `reset` between unrelated
 * streams. Hot path is allocation-free.
 */

export interface BiquadCoeffs {
  readonly b0: number
  readonly b1: number
  readonly b2: number
  readonly a1: number
  readonly a2: number
}

export class Biquad {
  readonly b0: number
  readonly b1: number
  readonly b2: number
  readonly a1: number
  readonly a2: number
  private z1 = 0
  private z2 = 0

  constructor(coeffs: BiquadCoeffs) {
    this.b0 = coeffs.b0
    this.b1 = coeffs.b1
    this.b2 = coeffs.b2
    this.a1 = coeffs.a1
    this.a2 = coeffs.a2
  }

  processSample(x: number): number {
    const y = this.b0 * x + this.z1
    this.z1 = this.b1 * x - this.a1 * y + this.z2
    this.z2 = this.b2 * x - this.a2 * y
    return y
  }

  process(input: ArrayLike<number>, start: number, end: number, output: Float64Array): void {
    const { b0, b1, b2, a1, a2 } = this
    let z1 = this.z1
    let z2 = this.z2
    let o = 0
    for (let i = start; i < end; i++, o++) {
      const x = input[i]
      const y = b0 * x + z1
      z1 = b1 * x - a1 * y + z2
      z2 = b2 * x - a2 * y
      output[o] = y
    }
    this.z1 = z1
    this.z2 = z2
  }

  reset(): void {
    this.z1 = 0
    this.z2 = 0
  }
}

/** Cascade of biquads (second-order sections). */
export class SosFilter {
  readonly stages: readonly Biquad[]

  constructor(stages: readonly Biquad[]) {
    this.stages = stages
  }

  processSample(x: number): number {
    let y = x
    for (let i = 0; i < this.stages.length; i++) y = this.stages[i].processSample(y)
    return y
  }

  process(input: ArrayLike<number>, start: number, end: number, output: Float64Array): void {
    const n = end - start
    this.stages[0].process(input, start, end, output)
    for (let s = 1; s < this.stages.length; s++) {
      this.stages[s].process(output, 0, n, output)
    }
  }

  reset(): void {
    for (let i = 0; i < this.stages.length; i++) this.stages[i].reset()
  }
}

/** Complex magnitude of a biquad at angular frequency `omega` (rad/sample). */
export function biquadMagnitude(coeffs: BiquadCoeffs, omega: number): number {
  const c1 = Math.cos(omega)
  const c2 = Math.cos(2 * omega)
  const s1 = Math.sin(omega)
  const s2 = Math.sin(2 * omega)
  const nr = coeffs.b0 + coeffs.b1 * c1 + coeffs.b2 * c2
  const ni = -(coeffs.b1 * s1 + coeffs.b2 * s2)
  const dr = 1 + coeffs.a1 * c1 + coeffs.a2 * c2
  const di = -(coeffs.a1 * s1 + coeffs.a2 * s2)
  return Math.hypot(nr, ni) / Math.hypot(dr, di)
}

export function sosMagnitude(stages: readonly BiquadCoeffs[], omega: number): number {
  let mag = 1
  for (let i = 0; i < stages.length; i++) mag *= biquadMagnitude(stages[i], omega)
  return mag
}

/**
 * RBJ cookbook low-pass. `Q` defaults to 1/√2 (Butterworth).
 * Used to anti-alias before decimating a formant frame.
 */
export function lowpassBiquad(frequency: number, sampleRate: number, q = Math.SQRT1_2): Biquad {
  const w0 = (2 * Math.PI * frequency) / sampleRate
  const cosw = Math.cos(w0)
  const alpha = Math.sin(w0) / (2 * q)
  const a0 = 1 + alpha
  return new Biquad({
    b0: (1 - cosw) / 2 / a0,
    b1: (1 - cosw) / a0,
    b2: (1 - cosw) / 2 / a0,
    a1: (-2 * cosw) / a0,
    a2: (1 - alpha) / a0,
  })
}

/**
 * Two-pole resonator: poles at `r·e^{±iθ}` with `r = exp(−π·bw / sr)`.
 * Zeros at the origin so DC is not boosted. Peak-normalised after construction.
 */
export function resonatorBiquad(frequency: number, bandwidth: number, sampleRate: number): Biquad {
  const r = Math.exp((-Math.PI * bandwidth) / sampleRate)
  const theta = (2 * Math.PI * frequency) / sampleRate
  const a1 = -2 * r * Math.cos(theta)
  const a2 = r * r
  const raw: BiquadCoeffs = { b0: 1, b1: 0, b2: 0, a1, a2 }
  const peak = biquadMagnitude(raw, theta)
  return new Biquad({ b0: 1 / peak, b1: 0, b2: 0, a1, a2 })
}
