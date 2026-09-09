/**
 * K-weighting filter from ITU-R BS.1770-4.
 *
 * Stage 1 is a high shelf (~+4 dB above 1.7 kHz); stage 2 is a 2nd-order high-pass at ~38 Hz.
 * Analogue prototypes and bilinear transform match libebur128 (MIT): the 48 kHz coefficients
 * reproduce the numbers published in the Recommendation.
 */

import { Biquad, SosFilter, sosMagnitude, type BiquadCoeffs } from './biquad'

/** High-shelf analogue prototype (libebur128). */
const SHELF = { f0: 1681.974450955533, G: 3.999843853973347, Q: 0.7071752369554196 }
/** High-pass analogue prototype (libebur128). */
const HIGHPASS = { f0: 38.13547087602444, Q: 0.5003270373238773 }

/** 48 kHz coefficients published in ITU-R BS.1770-4, for tests. */
export const ITU_48K_SHELF: BiquadCoeffs = {
  b0: 1.53512485958697,
  b1: -2.69169618940638,
  b2: 1.19839281085285,
  a1: -1.69065929318241,
  a2: 0.73248077421585,
}

export const ITU_48K_HIGHPASS: BiquadCoeffs = {
  b0: 1.0,
  b1: -2.0,
  b2: 1.0,
  a1: -1.99004745483398,
  a2: 0.99007225036621,
}

export function kWeightingCoeffs(sampleRate: number): [BiquadCoeffs, BiquadCoeffs] {
  return [shelfCoeffs(sampleRate), highpassCoeffs(sampleRate)]
}

export function kWeighting(sampleRate: number): SosFilter {
  const [shelf, highpass] = kWeightingCoeffs(sampleRate)
  return new SosFilter([new Biquad(shelf), new Biquad(highpass)])
}

/** Linear gain of the K-filter at `frequency` Hz. */
export function kWeightingGain(sampleRate: number, frequency: number): number {
  const omega = (2 * Math.PI * frequency) / sampleRate
  return sosMagnitude(kWeightingCoeffs(sampleRate), omega)
}

function shelfCoeffs(sampleRate: number): BiquadCoeffs {
  const K = Math.tan((Math.PI * SHELF.f0) / sampleRate)
  const Vh = 10 ** (SHELF.G / 20)
  const Vb = Vh ** 0.4996667741545416
  const a0 = 1 + K / SHELF.Q + K * K
  return {
    b0: (Vh + (Vb * K) / SHELF.Q + K * K) / a0,
    b1: (2 * (K * K - Vh)) / a0,
    b2: (Vh - (Vb * K) / SHELF.Q + K * K) / a0,
    a1: (2 * (K * K - 1)) / a0,
    a2: (1 - K / SHELF.Q + K * K) / a0,
  }
}

function highpassCoeffs(sampleRate: number): BiquadCoeffs {
  const K = Math.tan((Math.PI * HIGHPASS.f0) / sampleRate)
  const a0 = 1 + K / HIGHPASS.Q + K * K
  return {
    b0: 1 / a0,
    b1: -2 / a0,
    b2: 1 / a0,
    a1: (2 * (K * K - 1)) / a0,
    a2: (1 - K / HIGHPASS.Q + K * K) / a0,
  }
}
