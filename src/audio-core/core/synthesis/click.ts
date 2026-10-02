/**
 * Deterministic click samples for the metronome.
 *
 * Two decaying partials, no noise: the same buffer is what tests inspect and what the Web Audio
 * adapter plays, so the click the trainee hears is the click the calibrator looks for.
 */

import type { ClickLevel } from './metronome'

const VOICES: Record<ClickLevel, { f0: number; f1: number; peak: number; decay: number }> = {
  bar: { f0: 920, f1: 1840, peak: 0.72, decay: 58 },
  group: { f0: 800, f1: 1600, peak: 0.58, decay: 66 },
  beat: { f0: 680, f1: 1320, peak: 0.45, decay: 74 },
}

export function renderClick(sampleRate: number, level: ClickLevel): Float32Array {
  const seconds = 0.055
  const n = Math.max(1, Math.round(sampleRate * seconds))
  const out = new Float32Array(n)
  const { f0, f1, peak, decay } = VOICES[level]
  const w0 = (2 * Math.PI * f0) / sampleRate
  const w1 = (2 * Math.PI * f1) / sampleRate
  for (let i = 0; i < n; i++) {
    const env = Math.exp((-decay * i) / sampleRate)
    out[i] = peak * env * (Math.sin(w0 * i) + 0.35 * Math.sin(w1 * i))
  }
  return out
}

/**
 * The second layer's pulse: a short burst of brightened noise from a fixed seed, like a closed
 * hi-hat, so it never blurs with the pitched beat click. A little stronger on the beat.
 */
export function renderPulse(sampleRate: number, onBeat: boolean): Float32Array {
  const seconds = 0.04
  const n = Math.max(1, Math.round(sampleRate * seconds))
  const out = new Float32Array(n)
  const peak = onBeat ? 0.5 : 0.36
  let seed = 0x2545f491
  let previous = 0
  for (let i = 0; i < n; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) | 0
    const noise = (seed >>> 8) / 0x800000 - 1
    // A first difference tilts the noise towards the top, where a hi-hat lives.
    const bright = (noise - previous) / 2
    previous = noise
    out[i] = peak * Math.exp((-110 * i) / sampleRate) * bright
  }
  return out
}
