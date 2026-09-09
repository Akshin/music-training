/**
 * Window functions.
 *
 * `periodic = true` (default) divides by N rather than N − 1, which is the right choice for
 * spectral analysis of a frame that is one period of an implicitly repeated signal.
 */

export type WindowType = 'rectangular' | 'hann' | 'hamming' | 'blackmanHarris'

export function makeWindow(type: WindowType, size: number, periodic = true): Float64Array {
  switch (type) {
    case 'rectangular':
      return new Float64Array(size).fill(1)
    case 'hann':
      return hann(size, periodic)
    case 'hamming':
      return hamming(size, periodic)
    case 'blackmanHarris':
      return blackmanHarris(size, periodic)
  }
}

export function hann(size: number, periodic = true): Float64Array {
  return cosineSum(size, periodic, [0.5, 0.5])
}

export function hamming(size: number, periodic = true): Float64Array {
  return cosineSum(size, periodic, [0.54, 0.46])
}

/** 4-term Blackman-Harris (−92 dB sidelobes). */
export function blackmanHarris(size: number, periodic = true): Float64Array {
  return cosineSum(size, periodic, [0.35875, 0.48829, 0.14128, 0.01168])
}

/**
 * Gaussian window. `sigma` is the standard deviation relative to half the window length
 * (0.4 ≈ truncation at 2.5σ, a common choice for formant analysis).
 */
export function gaussian(size: number, sigma = 0.4): Float64Array {
  const window = new Float64Array(size)
  const centre = (size - 1) / 2
  const spread = sigma * centre
  for (let n = 0; n < size; n++) {
    const z = (n - centre) / spread
    window[n] = Math.exp(-0.5 * z * z)
  }
  return window
}

/** `out[i] = input[i] · window[i]`. `out` may alias `input` when both are Float64Array. */
export function applyWindow(
  input: ArrayLike<number>,
  window: Float64Array,
  out: Float64Array | Float32Array,
): void {
  const n = window.length
  for (let i = 0; i < n; i++) out[i] = input[i] * window[i]
}

/** Σ w[n] — the coherent gain; divide a spectrum by it to read amplitudes in signal units. */
export function windowSum(window: Float64Array): number {
  let sum = 0
  for (let i = 0; i < window.length; i++) sum += window[i]
  return sum
}

function cosineSum(size: number, periodic: boolean, coefficients: readonly number[]): Float64Array {
  const window = new Float64Array(size)
  const denominator = periodic ? size : size - 1
  for (let n = 0; n < size; n++) {
    const angle = (2 * Math.PI * n) / denominator
    let value = 0
    for (let k = 0; k < coefficients.length; k++) {
      value += (k % 2 === 0 ? 1 : -1) * coefficients[k] * Math.cos(k * angle)
    }
    window[n] = value
  }
  return window
}
